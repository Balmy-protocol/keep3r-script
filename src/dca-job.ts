import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import type {TransactionRequest} from '@ethersproject/abstract-provider';
import {
  getMainnetGasType2Parameters,
  sendAndRetryUntilNotWorkable,
  populateTransactions,
  createBundlesWithSameTxs,
  Flashbots,
} from '@keep3r-network/keeper-scripting-utils';
import dotenv from 'dotenv';
import type {Overrides} from 'ethers';
import {providers, Wallet} from 'ethers';
import {request} from 'undici';
import {API_URL, BURST_SIZE, CHAIN_ID, FLASHBOTS_RPC, FUTURE_BLOCKS, INTERVAL, PRIORITY_FEE} from './utils/contants';
import {getEnvVariable} from './utils/misc';

dotenv.config();

/*
  This job is meant to execute DCA swaps for Mean Finance. There is already an API that will:
  1. Check if there is something to swap
  2. If there is, then it will find the best quotes to execute said swaps
  3. Return everything that is needed for swap executions
  
  So the keeper will only have to:
  1. Check every few minutes if there is something to swap by calling the API
  2. If there is, then execute it
 */
/* ==============================================================/*
                          SETUP
/*============================================================== */

// environment variables usage
const provider = new providers.JsonRpcProvider(getEnvVariable('RPC_HTTPS_URI'));
const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);
const bundleSigner = new Wallet(getEnvVariable('BUNDLE_SIGNER_PRIVATE_KEY'), provider);

// Instantiates the contract
const dcaJob = getMainnetSdk(txSigner).dcaJob;

// Creates a flag to signar if there is already a job in progress
let jobWorkInProgress = false;

/**
 * @notice Checks every few minutes if there is something to be worked. If there is, then it tries to execute it
 */
async function run() {
  console.log('START runUpkeepJob()');
  const flashbots = await Flashbots.init(txSigner, bundleSigner, provider, [FLASHBOTS_RPC], true, CHAIN_ID);

  setInterval(async () => {
    if (jobWorkInProgress) {
      console.debug('Work already in progress for job');
      return;
    }

    jobWorkInProgress = true;
    try {
      await tryToWorkJob(flashbots);
    } finally {
      jobWorkInProgress = false;
    }
  }, INTERVAL);
}

/**
 * @notice Attempts to work the job.
 */
async function tryToWorkJob(flashbots: Flashbots) {
  // Call the API to get the needed swaps
  // Note: this request is very time expensive because it will try to group as many pair swaps as possible. Each attempt
  //       requires asking DEXes for quotes, so it can take a while (up to ~30 seconds sometimes)
  const {statusCode, body} = await request(API_URL);
  if (statusCode !== 200) {
    console.warn('Request to Mean API failed');
    return;
  }

  const result = await body.json();
  if (!result.swapToExecute) {
    console.debug('There is nothing to execute');
    return;
  }

  const {data, v, r, s} = result.params;

  // Prepare check to see if the job is workable
  const isWorkableCheck = async () => {
    try {
      await dcaJob.connect(txSigner).callStatic.work(data, v, r, s);
      return true;
    } catch {
      return false;
    }
  };

  // Calls job contract to check if it's actually workable
  const isWorkable = await isWorkableCheck();

  // If the job is not workable for any reason, the execution of the function is stopped
  if (!isWorkable) {
    console.log('Job is not workable');
    return;
  }

  console.debug('Job is workable');
  try {
    // Get the signer's (keeper) current nonce and the current block number
    const [currentNonce, currentBlock] = await Promise.all([provider.getTransactionCount(txSigner.address), provider.getBlock('latest')]);

    /*
        We are going to send this through Flashbots, which means we will be sending multiple bundles to different
        blocks inside a batch. Here we are calculating which will be the last block of our batch of bundles.
        This information is needed to calculate what will the maximum possible base fee be in that block, so we can
        calculate the maxFeePerGas parameter for all our transactions.
        For example: we are in block 100 and we send to 100, 101, 102. We would like to know what is the maximum possible
        base fee at block 102 to make sure we don't populate our transactions with a very low maxFeePerGas, as this would
        cause our transaction to not be mined until the max base fee lowers.
    */
    const blocksAhead = FUTURE_BLOCKS + BURST_SIZE;

    // Fetch the priorityFeeInGwei and maxFeePerGas parameters from the getMainnetGasType2Parameters function
    // NOTE: this just returns our priorityFee in GWEI, it doesn't calculate it, so if we pass a priority fee of 10 wei
    //       this will return a priority fee of 10 GWEI. We need to pass it so that it properly calculated the maxFeePerGas
    const {priorityFeeInGwei, maxFeePerGas} = getMainnetGasType2Parameters({
      block: currentBlock,
      blocksAhead,
      priorityFeeInWei: PRIORITY_FEE,
    });

    // We declare what options we would like our transaction to have
    const options: Overrides = {
      gasLimit: 20_000_000,
      nonce: currentNonce,
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFeeInGwei,
      type: 2,
    };

    // We calculate the first block that the first bundle in our batch will target.
    // Example, if future blocks is 2, and we are in block 100, it will send a bundle to blocks 102, 103, 104 (assuming a burst size of 3)
    // and 102 would be the firstBlockOfBatch
    const firstBlockOfBatch = currentBlock.number + FUTURE_BLOCKS;

    // We populate the transactions we will use in our bundles. Notice we are calling the upkeepJob's work function
    // with the args that the job.workable function gaves us.
    const txs: TransactionRequest[] = await populateTransactions({
      chainId: CHAIN_ID,
      contract: dcaJob,
      functionArgs: [[data, v, r, s]],
      functionName: 'work',
      options,
    });

    /*
      We create our batch of bundles. In this case this will be a batch of two bundles that will contain the same transaction.
    */
    const bundles = createBundlesWithSameTxs({
      unsignedTxs: txs,
      burstSize: BURST_SIZE,
      firstBlockOfBatch,
    });

    /*
      We send our batch of bundles and recreate new ones until we work it stops being workable      
    */
    const result = await sendAndRetryUntilNotWorkable({
      txs,
      provider,
      priorityFeeInWei: PRIORITY_FEE,
      signer: txSigner,
      bundles,
      newBurstSize: BURST_SIZE,
      flashbots,
      isWorkableCheck,
    });

    // If the bundle was included, we console log the success
    if (result) console.log('===== Tx SUCCESS =====');
  } catch (error: unknown) {
    console.error(error);
  }
}

(async () => {
  await run();
})();

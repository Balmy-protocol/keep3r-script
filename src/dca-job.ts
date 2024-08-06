import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import type {BroadcastorProps} from '@keep3r-network/keeper-scripting-utils';
import {PrivateBroadcastor, getEnvVariable, BlockListener} from '@keep3r-network/keeper-scripting-utils';
import dotenv from 'dotenv';
import type {Contract} from 'ethers';
import {providers, Wallet} from 'ethers';
import {request} from 'undici';
import {API_URL, CHAIN_ID, FLASHBOTS_RPCS, PRIORITY_FEE} from './utils/contants';

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

(async () => {
  // Environment variables usage
  const provider = new providers.JsonRpcProvider(getEnvVariable('RPC_HTTP_MAINNET_URI'));
  const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);

  // Instantiates the contract
  const dcaJob = getMainnetSdk(txSigner).dcaJob;

  // Instantiates the broadcastor
  const broadcastor = new PrivateBroadcastor(FLASHBOTS_RPCS, PRIORITY_FEE, 10e6, true, CHAIN_ID);

  // Run the script
  await run(dcaJob, provider, broadcastor);
})();

// Creates a flag to signal if there is already a job in progress
let jobWorkInProgress = false;

/**
 * @notice Checks every few minutes if there is something to be worked. If there is, then it tries to execute it
 */
async function run(dcaJob: Contract, provider: providers.JsonRpcProvider, broadcastor: PrivateBroadcastor) {
  const blockListener = new BlockListener(provider);

  blockListener.stream(async (block) => {
    if (jobWorkInProgress) {
      console.debug('Work already in progress for job');
      return;
    }

    jobWorkInProgress = true;
    try {
      await tryToWorkJob(dcaJob, block, 'work', broadcastor.tryToWork.bind(broadcastor));
    } finally {
      jobWorkInProgress = false;
    }
  });
}

/**
 * @notice Attempts to work the job.
 */
async function tryToWorkJob(
  dcaJob: Contract,
  block: providers.Block,
  workMethod: string,
  broadcastMethod: (props: BroadcastorProps) => Promise<void>,
) {
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
  const isWorkableCheck = async (): Promise<boolean> => {
    try {
      await dcaJob.callStatic.work(data, v, r, s);
      return true;
    } catch {
      return false;
    }
  };

  // Prepare check to see if the job is workable
  const estimateGas = async (): Promise<number> => {
    const gasEstimated = await dcaJob.estimateGas.work(data, v, r, s);
    return gasEstimated.toNumber();
  };

  // Calls job contract to check if it's actually workable
  const isWorkable = await isWorkableCheck();

  // If the job is not workable for any reason, the execution of the function is stopped
  if (!isWorkable) {
    console.log('Job is not workable');
    return;
  }

  const gasUsed = await estimateGas();

  console.debug('Job is workable');

  await broadcastMethod({jobContract: dcaJob, workMethod, workArguments: [data, v, r, s], block});
}

import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import type {BroadcastorProps} from '@keep3r-network/keeper-scripting-utils';
import {PrivateBroadcastor, getEnvVariable, BlockListener} from '@keep3r-network/keeper-scripting-utils';
import type {Contract} from 'ethers';
import {providers, Wallet} from 'ethers';
import {request} from 'undici';
import {API_URL, CHAIN_ID, RELAYER_RPCS, PRIORITY_FEE, GAS_LIMIT} from './utils/contants';

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

// Creates a flag to signal if there is already a job in progress
let jobWorkInProgress = false;

(async () => {
  // Environment variables usage
  const provider = new providers.JsonRpcProvider(getEnvVariable('RPC_HTTP_MAINNET_URI'));
  const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);

  // Instantiates the contract
  const dcaJob = getMainnetSdk(txSigner).dcaJob;

  // Instantiates the broadcastor
  const broadcastor = new PrivateBroadcastor(RELAYER_RPCS, PRIORITY_FEE, GAS_LIMIT, true, CHAIN_ID);

  // Run the script
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
})();

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
  const latestBlock: providers.Block = await dcaJob.provider.getBlock('latest');

  await broadcastMethod({jobContract: dcaJob, workMethod, workArguments: [data, v, r, s], block: latestBlock});
}

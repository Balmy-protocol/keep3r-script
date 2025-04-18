// Ethereum Mainnet
export const CHAIN_ID = 1;

// Size of our batch of bundles
export const BURST_SIZE = 3;

// Blocks into the future to send our first batch of bundles
export const FUTURE_BLOCKS = 0;

// Priority fee to use
export const PRIORITY_FEE = 2.1;

// Flashbots RPC. Taken from https://docs.flashbots.net
export const FLASHBOTS_RPC = 'https://relay.flashbots.net';

// The API to find the best quotes
export const API_URL = 'https://api.balmy.xyz/v1/dca/networks/1/keep3r';

// The time interval to check if there is something to swap
export const INTERVAL = 5 * 60 * 1000; // Every five minutes

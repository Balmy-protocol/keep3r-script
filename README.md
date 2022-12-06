# Mean Finance's Keeper Scripts

This repository enables keepers of the Keep3r Network to execute Mean Finance's jobs on Ethereum.

## How to run

1. Clone the repository

```
  git clone https://github.com/Mean-Finance/keep3r-script
```

2. Install dependencies

```
  yarn install
```

3. Create and complete the `.env` file using `env.example` as an example

4. Fine-tune the constants in `src/constants.ts` to your liking. Read [the docs](https://docs.keep3r.network/keeper-scripts) for a technical in-depth explanation.

5. Try out the scripts

```
  yarn start
```

## Run in production

1. Build the typescript into javascript

```
  yarn build
```

2. Run the job directly from javascript (using [PM2](https://github.com/Unitech/pm2) is highly recommended)

```
  node dist/dca-job.js
```

## Keeper Requirements

- Must be a valid (activated) Keeper on [Keep3r V2](https://etherscan.io/address/0xeb02addCfD8B773A5FFA6B9d1FE99c566f8c44CC)

## Useful Links

- [Keep3r Job](https://etherscan.io/address/0x62496bDF47De3c07e12F84a20681426AbCC618e2)

# Vesper-bot

Vesper bot automate pool operations.

### Setup

- Clone bot repository

  ```
  git clone git@github.com:bloqpriv/vesper-bot.git
  ```

- Install npm modules

  ```
  npm i
  ```

- Set environment variable in `.env` file at project root.

  ```
  MNEMONIC=<<mnemonic>>
  NODE_URL=<<ethereum mainnet /testnet node url>>
  ```

  Add below variables for `polygon` network

  ```
  NETWORK="polygon"
  POLYGON_NODE_URL=<<polygon mainnet /testnet node url>>
  ```

- Fork mainnet

  ```
  npm run fork
  ```

### Testing with fork

#### Rebalance
In this function will deposit/withdraw fund from pool/strategies and market providers.
- Rebalance for all active strategies

```
   serverless invoke local --function rebalance --data '{"pools": "vVSP,vWBTC,vDAI"}'
```

- Rebalance for one strategy

```
   serverless invoke local --function rebalance --data '{"pools": "vUSDT", "strategy" : "<<address>>"}'
```

#### Revenue Splitter
This function split revenue between Vesper strategy developer and VBC after deducting pool operational cost.
```
serverless invoke local --function splitRevenue
```

#### V3 Pool functions

- `lowWater` - This function will call rebalance if a maker strategy is lowWater.
- `feeTransfer` - This function will sweep erc20 tokens (vtokens) from strategies.
- `updateOracles` - This function will update oracles.
- `buybackVsp` - Buyback VSP using an asset with provided amount.


#### V2 Pools Functions

- `accrueInterest` - This function calls accrue interest` on V2 pools.
- `resurface` - This function will resurface pool if it goes under water for maker strategies.
- `rebalanceCollateral` - This function will rebalance collateral ratio for maker strategies.
- `deployFund` - This function will deposit fund to corresponding market provider.

#### VUSD Functions

- `claimComp` - This function will claim comp from VUSD treasury and convert to one of allowed tokens.


### AWS deployment (Secret/Dynamodb/Lambda)

Follow below steps to deploy Vesper bot in AWS environment.

- Setup aws credential `~/.aws/credentials` Stage environment.

- Create AWS secret with following keys for ethereum mainnet
- Crate an account on https://papertrailapp.com/ and setup project for logging.

```
  vesper-bot-stage-DEPLOYMENT_ACCOUNT_KEY   // Mnemonic
  vesper-bot-stage-NODE_URL                 // Ethereum mainnet URL
  vesper-bot-stage-LOGGER_PAPERTRAIL_HOST   // Papertrail host
  vesper-bot-stage-LOGGER_PAPERTRAIL_PORT   // Papertrail port
```

- Create aws dynamodb table with name `stage_vesper_bot_transaction` with field `src/db/schema.js`

- Deploy AWS lambda functions

```
serverless deploy --stage stage
```

- Grant access to all secret keys/dynamo db table for all lambda functions

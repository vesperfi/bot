'use strict'
const {BigNumber: BN} = require('ethers')
const ethers = require('ethers')
const config = require('config')
const {saveTransaction} = require('../util/transactionUtil')
const {getGasPrice, getProvider, getNetwork, getChainId, isPolygon, getNetworkUrl} = require('../ethers/eth')
const {FORK_ETH_URL} = require('../enum/network')
const {getLogger} = require('../util/logger')
const {Priority} = require('../enum/priority')
const {Status} = require('../enum/status')
const {FlashbotsBundleProvider} = require('@flashbots/ethers-provider-bundle')
const FEE_ERROR = 'max fee per gas less than block base fee'
const GAS_MULTIPLIER = 160

async function sendSignedTxnsToMiner(signedTransactions, blockFromNow = 1) {
  // flashbots do not support polygon network.
  const provider = getProvider()
  const authSigner = new ethers.Wallet(process.env.FLASHBOT_SIGN_KEY, provider)
  return FlashbotsBundleProvider.create(provider, authSigner).then(function (flashbotsProvider) {
    return flashbotsProvider.signBundle(signedTransactions).then(function (signedBundle) {
      return provider.getBlockNumber().then(async function (_blockNumber) {
        const logger = getLogger()
        let blockNumber = _blockNumber
        blockNumber = blockNumber + blockFromNow
        const txnResponse = await flashbotsProvider.sendRawBundle(signedBundle, blockNumber)
        logger.info('Txn submitted via FlashBots, blockNumber: %s', blockNumber)
        await txnResponse.wait() // wait for block to mined
        const simulateResponse = await txnResponse.simulate()
        logger.info(`simulateResponse: ${JSON.stringify(simulateResponse)}`)
        // when txn bundled is picked and mined, then simulate returns error code as -32000 due to low nonce.
        if (
          simulateResponse.error &&
          simulateResponse.error.code === -32000 &&
          !simulateResponse.error.message.includes(FEE_ERROR)
        ) {
          return Status.SUCCESS
        }
        return Status.IGNORE
      })
    })
  })
}

function sendSignedTxn(params, signedTransaction) {
  return getProvider()
    .sendTransaction(signedTransaction)
    .then(function (txResponse) {
      params.transactionHash = txResponse.hash
      return saveTransaction(params)
    })
    .catch(function (error) {
      return saveTransaction(params, error)
    })
}

function prepareSignedTxn(params, contractObj, methodName, methodArgs) {
  const estimatePromise = methodArgs
    ? contractObj.estimateGas[methodName](...methodArgs)
    : contractObj.estimateGas[methodName]()
  return estimatePromise.then(function (_gas) {
    const gasMultiplier = params.sendViaFlashBots ? config.vesper.flashBotGasMultiplier : GAS_MULTIPLIER
    const gas = BN.from(_gas).mul(BN.from(gasMultiplier)).div(100).toString()
    params.gas = gas
    params.priority = params.priority ? params.priority : 0
    const logger = getLogger()
    logger.info(
      'Preparing transaction operation: %s, pool: %s, nonce: %s, network: %s, ' +
        'maxFeePerGas: %s, maxPriorityFeePerGas: %s, toAddress: %s',
      params.operation,
      params.pool,
      params.nonce,
      params.network,
      params.gasPrice,
      params.priority,
      params.toAddress
    )
    const txPromise = methodArgs
      ? contractObj.populateTransaction[methodName](...methodArgs)
      : contractObj.populateTransaction[methodName]()

    return txPromise.then(function (encodedData) {
      const txnParams = {
        gasLimit: BN.from(gas).toHexString(),
        nonce: BN.from(params.nonce).toHexString(),
        value: BN.from(0).toHexString(),
        data: encodedData.data,
        from: encodedData.from,
        to: encodedData.to,
        chainId: getChainId(),
      }
      if (isPolygon() || config.vesper.txnType === 0 || getNetworkUrl() === FORK_ETH_URL) {
        // polygon and fork use legacy
        txnParams.gasPrice = BN.from(params.gasPrice).toHexString()
      } else {
        txnParams.type = config.vesper.txnType
        txnParams.maxFeePerGas = BN.from(params.gasPrice).toHexString()
        txnParams.maxPriorityFeePerGas = BN.from(params.priority + 1)
          .mul(100000000)
          .toHexString()
      }
      return contractObj.signer.signTransaction(txnParams)
    })
  })
}

async function sendViaFlashBot(params, contractObj, methodName, methodArgs) {
  return getGasPrice().then(function (gasPrice) {
    params.gasPrice = gasPrice
    params.priority = Priority.FLASHBOT
    return prepareSignedTxn(params, contractObj, methodName, methodArgs).then(function (signedTransaction) {
      const signedTransactions = []
      signedTransactions.push({signedTransaction})
      return sendSignedTxnsToMiner(signedTransactions)
    })
  })
}

async function send(params, contractObj, methodName, methodArgs) {
  params.network = getNetwork()
  if (params.sendViaFlashBots) {
    const retryCount = 5
    for (let count = 0; count < retryCount; count++) {
      const result = await sendViaFlashBot(params, contractObj, methodName, methodArgs)
      if (result === Status.SUCCESS) return Status.SUCCESS
    }
    const logger = getLogger()
    logger.warn('Txn not mined by miners in retry count: %s', retryCount)
    return Status.IGNORE
  }
  // send non flashbot txns
  return prepareSignedTxn(params, contractObj, methodName, methodArgs)
    .then(function (signedTransaction) {
      return sendSignedTxn(params, signedTransaction)
    })
    .catch(function (error) {
      params.txnStatus = Status.FAILED
      const errorBody = error.body ? error.body : error.error.body
      return saveTransaction(params, JSON.parse(errorBody).error.message)
    })
}

module.exports = {
  send,
  prepareSignedTxn,
  sendSignedTxnsToMiner,
}

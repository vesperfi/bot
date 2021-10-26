/* eslint-disable consistent-return */
'use strict'

const config = require('config')
const ethers = require('ethers')
const {getGasPrice, isGasPriceAffordable, getWallet, getBalance} = require('../../ethers/eth')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {isRecentTransaction} = require('../recent')
const {getContractMetadata} = require('../../util/contract')
const {send} = require('../transaction')
const {getTokenQuoteInUSD} = require('../../util/swapper')
const strategyAbi = require('../../abi/strategy.json')
const poolProxyAbi = require('../../abi/poolProxyImpl.json')
const {BigNumber: BN} = require('ethers')
const {getLogger} = require('../../util/logger')
const operation = Operation.FEE_TRANSFER

async function getPoolContract(strategyAddress) {
  return getWallet().then(async function (wallet) {
    const strategyContract = new ethers.Contract(strategyAddress, strategyAbi, wallet)
    return strategyContract.pool().then(function (poolAddress) {
      return new ethers.Contract(poolAddress, poolProxyAbi, wallet)
    })
  })
}

function isEnoughFundAvailable(data) {
  return getPoolContract(data.toAddress).then(function (poolContract) {
    return Promise.all([
      poolContract.token(),
      poolContract.decimals(),
      poolContract.pricePerShare(),
      getBalance(poolContract.address, data.toAddress),
    ]).then(function ([token, poolDecimals, pricePerShare, balance]) {
      data.assetAddress = poolContract.address
      const amount = BN.from(balance)
        .mul(pricePerShare)
        .div(BN.from(10).pow(BN.from(poolDecimals)))
      return getTokenQuoteInUSD(token, amount).then(function (balanceInUSD) {
        const logger = getLogger()
        logger.info(
          'poolName %s:, Strategy address: %s, vToken balance in USD: %s, minimum USD: %s',
          data.name,
          data.toAddress,
          balanceInUSD.toString(),
          config.vesper.minimumFeeTransferAmount.toString()
        )
        return balanceInUSD.gt(BN.from(config.vesper.minimumFeeTransferAmount))
      })
    })
  })
}

async function shouldSkipTheJob(data) {
  return isGasPriceAffordable().then(function (result) {
    if (result) {
      return Promise.all([isRecentTransaction(data), isEnoughFundAvailable(data)]).then(function ([
        isRecent,
        enoughBalance,
      ]) {
        return isRecent || !enoughBalance
      })
    }
    return true
  })
}

function run(data) {
  const priority = config.vesper[data.operation] ? config.vesper[data.operation].priority : config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name || data.pool,
      nonce: data.nonce,
      priority: getPriority(priority),
      gasPrice,
      operation: data.operation,
      toAddress: data.toAddress,
      assetAddress: data.assetAddress,
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      const contract = new ethers.Contract(data.toAddress, strategyAbi, wallet)
      const methodArgs = [data.assetAddress]
      const logger = getLogger()
      logger.info(
        'poolName %s:, Strategy address: %s, vToken address: %s',
        data.name,
        data.toAddress,
        data.assetAddress
      )
      return send(params, contract, 'sweepERC20', methodArgs)
    })
  })
}

async function prepare() {
  const jobsWithStrategies = []
  return getContractMetadata([]).then(async function (jobs) {
    // const promises = []
    jobs.forEach(function (job) {
      job.strategies.forEach(function (strategy) {
        if (strategy.info.split(':')[1].startsWith('3.')) {
          // V3 pool/strategies only
          const strategyJob = Object.assign({}, job)
          strategyJob.operationObj = module.exports
          strategyJob.operation = Operation.FEE_TRANSFER
          strategyJob.toAddress = strategy.address
          jobsWithStrategies.push(strategyJob)
        }
      })
    })
    return jobsWithStrategies
  })
}

async function before(data) {
  return require('./pool').before(data)
}

async function after(data) {
  return require('./pool').after(data)
}

async function error(data, _error) {
  return require('./pool').error(data, _error)
}

async function executeJob(_data) {
  return before(_data).then(function (data) {
    return run(data)
      .then(function () {
        return after(data)
      })
      .catch(function (_error) {
        return error(data, _error)
      })
  })
}

module.exports = {
  prepare,
  executeJob,
  shouldSkipTheJob,
  operation,
}

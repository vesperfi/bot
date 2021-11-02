'use strict'

const config = require('config')
const ethers = require('ethers')
const {BigNumber: BN} = require('ethers')
const {isRecentTransaction} = require('../recent')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {send} = require('../transaction')
const {getGasPrice, getWallet} = require('../../ethers/eth')
const strategyAbi = require('../../abi/strategy.json')
const operation = Operation.REBALANCE_COLLATERAL

function isHighWater(data) {
  const enabled = config.vesper[data.operation][data.name].highWater
    ? config.vesper[data.operation][data.name].highWater
    : config.vesper[data.operation].highWater
  if (!enabled) {
    return false
  }
  const highWater = BN.from(data.strategy.makerVaultInfo.highWater)
  const buffer = BN.from(highWater).mul(BN.from(config.vesper.rebalanceCollateral.highWaterBufferPercentage)).div(100)
  return BN.from(data.collateralRatio).gte(highWater.add(buffer))
}

function isZeroFund(data) {
  return BN.from(data.strategy.makerVaultInfo.collateralRatio).isZero()
}

function isLowWater(data) {
  const enabled = config.vesper[data.operation][data.name].lowWater
    ? config.vesper[data.operation][data.name].lowWater
    : config.vesper[data.operation].lowWater
  if (!enabled) {
    return false
  }
  return BN.from(data.strategy.makerVaultInfo.collateralRatio).lte(BN.from(data.strategy.makerVaultInfo.lowWater))
}

async function shouldSkipTheJob(data) {
  if (!data.strategy.makerVaultInfo) {
    // return true if not maker.
    return true
  }
  if (isZeroFund(data) || (!isHighWater(data) && !isLowWater(data))) {
    return true
  }
  return isRecentTransaction(data)
}

function run(data) {
  const priority = isLowWater(data) ? 'high' : config.vesper[data.operation].priority || config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name,
      nonce: data.nonce,
      operation,
      priority: getPriority(priority),
      gasPrice,
      toAddress: data.strategy.address,
      isBlockingTxn: !!data.blockingTxnGasPrice
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      const contract = new ethers.Contract(params.toAddress, strategyAbi, wallet)
      return send(params, contract, params.operation)
    })
  })
}

async function prepare(input) {
  return require('./pool').prepare(input)
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

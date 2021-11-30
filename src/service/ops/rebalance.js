'use strict'

const config = require('config')
const ethers = require('ethers')
const {isRecentTransaction} = require('../recent')
const {getGasPrice, getWallet, isPolygon} = require('../../ethers/eth')
const {Pool} = require('../../enum/pools')
const {Priority, getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {send} = require('../transaction')
const {BigNumber: BN} = require('ethers')
const strategyAbi = require('../../abi/strategy.json')
const poolAbi = require('../../abi/pool.json')
const {getContractMetadata} = require('../../util/contract')
const poolProxyImplAbi = require('../../abi/poolProxyImpl.json')
const {getLogger} = require('../../util/logger')

const operation = Operation.REBALANCE

function isLegacyPool(name) {
  return (
    name === Pool.vETH ||
    name === Pool.vWBTC ||
    name === Pool.vBetaETH ||
    name === Pool.vBetaUSDC ||
    name === Pool.vBetaWBTC
  )
}

function isLegacyPoolStrategy(name) {
  return name === Pool.vVSP || name === Pool.vLINK || name === Pool.vUSDC || name === Pool.vDAI
}

function getMaxAllowedGasPrice() {
  return BN.from(config.vesper.maxTxnGasPrice)
}

function isGasPriceAffordable(data) {
  // eslint-disable-next-line complexity
  return getGasPrice().then(function (gasPrice) {
    const hour = new Date().getHours()
    const slot = hour % 6
    const minGasPrice = 30000000000 // 30 GWEI
    const hourlyIncrementalGasPrice = 20000000000 // 20 GWEI
    let allowedGasPrice = minGasPrice
    if (data.name === Pool.vVSP && BN.from(gasPrice).lte(getMaxAllowedGasPrice())) {
      return true
    }
    allowedGasPrice = slot === 0 ? minGasPrice : allowedGasPrice + slot * hourlyIncrementalGasPrice
    if (BN.from(gasPrice).lte(allowedGasPrice)) {
      return true
    }
    const logger = getLogger()
    logger.warn(
      'Skipping rebalance due to high gas: %s, pool: %s, strategy: %s, hour: %s, maxAllowedGasAtThisHour: %s',
      gasPrice,
      data.name,
      data.strategy.address,
      hour,
      allowedGasPrice
    )
    return false
  })
}

async function shouldSkipTheJob(data) {
  return isGasPriceAffordable(data).then(function (result) {
    if (result) {
      data.addOnInfo = `toAddress: ${data.strategy.address}`
      // Polygon only has V3 pools.
      if ((!isLegacyPool(data.name) && !isLegacyPoolStrategy(data.name)) || isPolygon()) {
        return getWallet(data.sendViaFlashBots).then(function (wallet) {
          const poolProxyContract = new ethers.Contract(data.contract.address, poolProxyImplAbi, wallet.provider)
          return poolProxyContract.strategy(data.strategy.address).then(function (metadata) {
            const allocation = data.allocation ? data.allocation : 0
            const shouldRun =
              metadata.active &&
              metadata.totalDebt.gt(BN.from(0)) &&
              metadata.debtRatio.gte(BN.from(allocation).mul(100))
            if (!shouldRun) {
              const logger = getLogger()
              logger.warn(
                'Skipping rebalance for pool: %s, strategy: %s, active: %s, totalDebt: %s, debtRatio: %s',
                data.name,
                data.strategy.address,
                metadata.active,
                metadata.totalDebt,
                metadata.debtRatio
              )
              return true
            }
            return isRecentTransaction(data)
          })
        })
      }
      return isRecentTransaction(data)
    }
    return true
  })
}

function run(data, contract) {
  const priority = data.sendViaFlashBots
    ? Priority.FLASHBOT
    : config.vesper[data.operation].priority || config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      fromAddress: data.fromAddress,
      pool: data.name,
      nonce: data.nonce,
      sendViaFlashBots: data.sendViaFlashBots,
      operation,
      priority: getPriority(priority),
      gasPrice,
      toAddress: data.toAddress,
      isBlockingTxn: !!data.blockingTxnGasPrice,
    }
    return send(params, contract, params.operation)
  })
}

async function prepare(input) {
  const jobsWithStrategies = []
  return getContractMetadata(
    input.pools.split(',').map(pool => ({
      name: pool,
      operation: input.operation,
      strategy: input.strategy,
      version: input.version,
    }))
  ).then(function (jobs) {
    jobs.forEach(function (job) {
      job.strategies.forEach(function (strategy) {
        const strategyJob = Object.assign({}, job)
        strategyJob.allocation = input.allocation
        strategyJob.sendViaFlashBots = input.sendViaFlashBots
        strategyJob.operationObj = module.exports
        strategyJob.strategy = strategy
        const logger = getLogger()
        if (config.vesper.rebalance.skipStrategies.includes(strategy.address)) {
          logger.warn('Blocked strategy, Skipping rebalance for strategy: %s', strategy.address)
        } else {
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
  if (!data.sendViaFlashBots) {
    return require('./pool').after(data)
  }
  return data
}

async function error(data, _error) {
  return require('./pool').error(data, _error)
}

async function execute(_data, contract) {
  return before(_data).then(function (data) {
    return run(data, contract)
      .then(function () {
        return after(data)
      })
      .catch(function (_error) {
        return error(data, _error)
      })
  })
}

async function executeJob(_data) {
  return getWallet(_data.sendViaFlashBots).then(function (wallet) {
    _data.fromAddress = wallet.address
    _data.toAddress = _data.strategy.address
    let contract = new ethers.Contract(_data.toAddress, strategyAbi, wallet)
    if (isLegacyPool(_data.name) && !isPolygon()) {
      _data.toAddress = _data.contract.address
      contract = new ethers.Contract(_data.toAddress, poolAbi, wallet)
    }
    return execute(_data, contract)
  })
}

module.exports = {
  prepare,
  executeJob,
  shouldSkipTheJob,
  operation,
}

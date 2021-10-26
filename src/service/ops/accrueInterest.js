'use strict'

const config = require('config')
const ethers = require('ethers')
const {isRecentTransaction} = require('../recent')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {send} = require('../transaction')
const {getGasPrice, getProvider, getWallet} = require('../../ethers/eth')
const cTokenAbi = require('../../abi/cTokenAbi.json')
const poolAbi = require('../../abi/pool.json')
const {getLogger} = require('../../util/logger')
const operation = Operation.ACCRUE_INTEREST

async function shouldSkipTheJob(data) {
  const poolContract = new ethers.Contract(data.poolAddress, poolAbi, getProvider())
  try {
    poolContract.totalValue()
  } catch (_error) {
    const logger = getLogger()
    logger.warn('pool.totalValue() is failing for Pool:%s, error: %s', data.name, _error)
    return isRecentTransaction(data)
  }
  return true
}

function run(data) {
  const priority = config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name,
      nonce: data.nonce,
      operation,
      priority: getPriority(priority),
      gasPrice,
      toAddress: data.toAddress,
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      const cTokenContract = new ethers.Contract(data.toAddress, cTokenAbi, wallet)
      return send(params, cTokenContract, params.operation)
    })
  })
}

async function prepare() {
  const jobs = []
  config.vesper.accrueInterest.v2Pools.forEach(function (pool) {
    const job = {
      operationObj: module.exports,
      toAddress: pool.cToken,
      poolAddress: pool.poolAddress,
      operation: Operation.ACCRUE_INTEREST,
      name: pool.name,
    }
    jobs.push(job)
  })
  return jobs
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

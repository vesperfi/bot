'use strict'

const config = require('config')
const ethers = require('ethers')
const {isRecentTransaction} = require('../recent')
const {getGasPrice} = require('../../ethers/eth')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {send} = require('../transaction')
const {getWallet} = require('../../ethers/eth')
const swapAbi = require('../../abi/swap.json')
const operation = Operation.UPDATE_ORACLES

async function shouldSkipTheJob(data) {
  return isRecentTransaction(data)
}

function run(data) {
  const priority = config.vesper[data.operation].priority || config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name,
      nonce: data.nonce,
      operation,
      priority: getPriority(priority),
      gasPrice,
      toAddress: data.toAddress,
      isBlockingTxn: !!data.blockingTxnGasPrice
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      const contract = new ethers.Contract(params.toAddress, swapAbi, wallet)
      return send(params, contract, `${params.operation}()`)
    })
  })
}

async function prepare() {
  return [
    {
      operationObj: module.exports,
      toAddress: config.vesper.vesperSwapManager,
      operation: Operation.UPDATE_ORACLES,
      name: Operation.UPDATE_ORACLES,
    },
  ]
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

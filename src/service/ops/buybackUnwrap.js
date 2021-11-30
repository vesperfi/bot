/* eslint-disable consistent-return */
'use strict'

const config = require('config')
const ethers = require('ethers')
const {getGasPrice, getWallet} = require('../../ethers/eth')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {isRecentTransaction} = require('../recent')
const revenueConfig = config.get('vesper.revenueConfig')
const {send} = require('../transaction')
const buybackUnwrapAbi = require('../../abi/buybackUnwrap.json')
const vesperERC20TokenAbi = require('../../abi/ERC20Abi.json')
const {BigNumber: BN} = require('ethers')
const operation = Operation.BUYBACK_UNWRAP

async function shouldSkipTheJob(data) {
  if (data.batchTxns.length > 0) {
    return isRecentTransaction(data)
  }
  return true
}

function run(data) {
  const priority = config.vesper[data.operation] ? config.vesper[data.operation].priority : config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name || data.pool,
      fromAddress: data.fromAddress,
      nonce: data.nonce,
      priority: getPriority(priority),
      gasPrice,
      operation: data.operation,
      toAddress: data.toAddress,
      isBlockingTxn: !!data.blockingTxnGasPrice,
    }
    const methodArgs = [data.batchTxns, false]
    return send(params, data.contract, 'batch', methodArgs)
  })
}

function prepare() {
  const data = []
  return getWallet().then(function (wallet) {
    const contract = new ethers.Contract(revenueConfig.buybackAddress, buybackUnwrapAbi, wallet)
    const tokensBalPromises = []
    for (const token of revenueConfig.tokens) {
      tokensBalPromises.push(
        new ethers.Contract(token.address, vesperERC20TokenAbi, wallet.provider).balanceOf(revenueConfig.buybackAddress)
      )
    }
    return Promise.all(tokensBalPromises).then(function (tokenBalances) {
      const unwrapPromises = []
      tokenBalances.forEach(function (balance, index) {
        if (balance.gte(BN.from(revenueConfig.tokens[index].minBalance))) {
          unwrapPromises.push(contract.populateTransaction.unwrapAll(revenueConfig.tokens[index].address))
        }
      })
      const batchTxns = []
      return Promise.all(unwrapPromises).then(function (txns) {
        for (const txn of txns) {
          batchTxns.push(txn.data)
        }
        data.push({
          operationObj: module.exports,
          toAddress: revenueConfig.buybackAddress,
          operation: Operation.BUYBACK_UNWRAP,
          name: Operation.BUYBACK_UNWRAP,
          batchTxns,
          fromAddress: wallet.address,
          contract,
        })
        return data
      })
    })
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

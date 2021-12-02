/* eslint-disable consistent-return */
'use strict'

const config = require('config')
const ethers = require('ethers')
const {getGasPrice, getWallet} = require('../../ethers/eth')
const {getContractMetadata} = require('../../util/contract')
const {getPriority} = require('../../enum/priority')
const poolProxyAbi = require('../../abi/poolProxyImpl.json')
const {Operation} = require('../../enum/operation')
const {isRecentTransaction} = require('../recent')
const revenueConfig = config.get('vesper.revenueConfig')
const {send} = require('../transaction')
const {getLogger} = require('../../util/logger')
const buybackAbi = require('../../abi/buybackAbi.json')
const vesperERC20TokenAbi = require('../../abi/ERC20Abi.json')
const {BigNumber: BN} = require('ethers')
const DECIMAL18 = BN.from('1000000000000000000')
const operation = Operation.BUYBACK_VSP

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
      // `payeeAddress` Using existing DDB column.
      payeeAddress: data.amount.toString(),
      assetAddress: data.asset,
      isBlockingTxn: !!data.blockingTxnGasPrice,
    }
    const methodArgs = [data.batchTxns, false]
    return send(params, data.contract, 'batch', methodArgs)
  })
}

function prepareJob(data, batchJobPromises) {
  const batchTxns = []
  return Promise.all(batchJobPromises).then(function (txns) {
    for (const txn of txns) {
      batchTxns.push(txn.data)
    }
    const jobs = []
    jobs.push({
      operationObj: module.exports,
      toAddress: revenueConfig.buybackAddress,
      operation: Operation.BUYBACK_VSP,
      name: Operation.BUYBACK_VSP,
      fromAddress: data.wallet.address,
      asset: data.asset,
      amount: data.amount,
      contract: data.contract,
      wallet: data.wallet,
      batchTxns,
    })
    return jobs
  })
}

function getPoolContract(vtoken, provider) {
  return new ethers.Contract(vtoken, poolProxyAbi, provider)
}

function getBalanceAmountInCollateralToken(poolContract) {
  const promises = []
  promises.push(poolContract.balanceOf(revenueConfig.buybackAddress))
  promises.push(poolContract.getPricePerShare())
  promises.push(poolContract.withdrawFee())
  return Promise.all(promises).then(function ([balance, pricePerShare, withdrawFee]) {
    const withdrawFeeAmount = balance.mul(withdrawFee).div(DECIMAL18)
    // all vTokens are 18 decimals
    return balance.sub(withdrawFeeAmount).mul(pricePerShare).div(DECIMAL18)
  })
}

function prepareVspBuyback(data, batchJobPromises) {
  batchJobPromises.push(data.contract.populateTransaction.swapForVspAndTransferToVVSP(data.asset, data.amount))
  return prepareJob(data, batchJobPromises)
}

function prepareUnwrapAndBuyback(data, batchJobPromises) {
  return getContractMetadata([]).then(async function (pools) {
    const poolPromises = []
    pools.forEach(function (poolObj) {
      poolPromises.push(getPoolContract(poolObj.contract.address, data.wallet.provider).token())
    })
    return Promise.all(poolPromises).then(function (tokens) {
      const vTokenBalPromises = []
      const matchedVToken = []
      tokens.forEach(function (token, index) {
        if (token === data.asset) {
          const vTokenContract = new ethers.Contract(token, vesperERC20TokenAbi, data.wallet.provider)
          matchedVToken.push(pools[index])
          vTokenBalPromises.push(vTokenContract.balanceOf(revenueConfig.buybackAddress))
        }
      })

      // Prepare mapping of vToken and it's balance.
      const vTokenBalMapping = {}
      return Promise.all(vTokenBalPromises).then(function (vTokenBalances) {
        vTokenBalances.forEach(function (vTokenBalance, matchVTokenIndex) {
          const key = matchedVToken[matchVTokenIndex].contract.address
          vTokenBalMapping[key] = vTokenBalance
        })

        // sort vToken's balance in decreasing order
        const vTokenBalMappingSorted = Object.fromEntries(Object.entries(vTokenBalMapping).sort((a, b) => b[1] - a[1]))
        const vTokens = Object.keys(vTokenBalMappingSorted)

        // Calculate vToken value in collateral token
        const balancePromise = []
        vTokens.forEach(function (vToken) {
          const poolContract = getPoolContract(vToken, data.wallet.provider)
          balancePromise.push(getBalanceAmountInCollateralToken(poolContract))
        })

        let availableBalance = data.buybackBalance
        const requiredAmount = data.amount
        let index = 0
        return Promise.all(balancePromise).then(function (balances) {
          // iterate and unwrap till we have enough collateral token balance for buyback
          while (requiredAmount.gt(availableBalance) && index < balances.length) {
            // prepare unwrap job
            batchJobPromises.push(data.contract.populateTransaction.unwrapAll(vTokens[index]))
            availableBalance = availableBalance.add(balances[index])
            index++
          }
          // Buy VSP only if enough balance.
          if (availableBalance.gte(requiredAmount)) {
            return prepareVspBuyback(data, batchJobPromises)
          }
          const logger = getLogger()
          logger.warn(
            'Buyback asset: %s, available balance: %s, Required amount: %s, Not enough balance for buyback',
            data.asset,
            availableBalance,
            requiredAmount
          )
          return prepareJob(data, [])
        })
      })
    })
  })
}

function prepare(data) {
  data.amount = BN.from(data.amount)
  if (data.amount.eq(0)) {
    throw new Error('Amount should be greater than zero')
  }
  return getWallet().then(function (wallet) {
    data.wallet = wallet
    data.contract = new ethers.Contract(revenueConfig.buybackAddress, buybackAbi, wallet)
    const collateralTokenContract = new ethers.Contract(data.asset, vesperERC20TokenAbi, wallet.provider)
    return collateralTokenContract.balanceOf(revenueConfig.buybackAddress).then(function (buybackBalance) {
      data.buybackBalance = buybackBalance
      const batchJobPromises = []
      if (data.buybackBalance.lt(data.amount)) {
        // Need to unwrap and then buyback
        return prepareUnwrapAndBuyback(data, batchJobPromises)
      }
      // unwrap not needed, just add buyback job
      return prepareVspBuyback(data, batchJobPromises)
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

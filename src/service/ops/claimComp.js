'use strict'

const config = require('config')
const ethers = require('ethers')
const {getPriority} = require('../../enum/priority')
const {BigNumber: BN} = require('ethers')
const {Operation} = require('../../enum/operation')
const {getGasPrice, getWallet, getProvider} = require('../../ethers/eth')
const {isRecentTransaction} = require('../recent')
const {send} = require('../transaction')
const {getTokenQuote} = require('../../util/swapper')
const {to18Decimals} = require('../../util/convert')
const {getLogger} = require('../../util/logger')
const operation = Operation.CLAIM_COMP
const vesper = config.vesper
const erc20Abi = require('../../abi/ERC20Abi.json')
const treasuryAbi = require('../../abi/treasury.json')
const comptrollerAbi = require('../../abi/comptroller.json')
const addressListAbi = require('../../abi/addressListAbi.json')

function getTotalComp() {
  const provider = getProvider()
  const contract = new ethers.Contract(config.vesper.comp, erc20Abi, provider)
  const balancePromise = contract.balanceOf(vesper.treasury)
  const comptrollerContract = new ethers.Contract(config.vesper.comptroller, comptrollerAbi, provider)
  const compPromise = comptrollerContract.compAccrued(vesper.treasury)
  return Promise.all([balancePromise, compPromise]).then(function ([compBalance, compAccrued]) {
    return BN.from(compBalance).add(BN.from(compAccrued))
  })
}

async function shouldSkipTheJob(data) {
  return getTotalComp().then(function (totalComp) {
    if (totalComp.gt(BN.from(config.vesper.claimComp.minBalance))) {
      return isRecentTransaction(data)
    }
    const logger = getLogger()
    logger.info(
      'Total accumulated COMP : %s is less than minimum required COMP : %s, Skipping operation',
      totalComp,
      config.vesper.claimComp.minBalance
    )
    return true
  })
}

async function getTokenBalance(token, wallet) {
  const _promises = []
  _promises.push(new ethers.Contract(token, erc20Abi, wallet.provider).balanceOf(vesper.treasury))
  _promises.push(new ethers.Contract(token, erc20Abi, wallet.provider).decimals())
  return Promise.all(_promises).then(function ([balance, decimals]) {
    return BN.from(to18Decimals(balance, decimals))
  })
}

function getTokenForCompClaim(wallet) {
  // Fetch whitelistedTokens from minter but using `whitelistedTokens` method ABI from treasury.
  return new ethers.Contract(vesper.minter, treasuryAbi, wallet.provider)
    .whitelistedTokens()
    .then(function (addressList) {
      return new ethers.Contract(addressList, addressListAbi, wallet.provider).length().then(function (_length) {
        const tokensPromise = []
        const tokenIndices = [...Array(parseInt(_length)).keys()]
        tokenIndices.forEach(function (_index) {
          tokensPromise.push(new ethers.Contract(addressList, addressListAbi, wallet.provider).at(_index))
        })
        return Promise.all(tokensPromise).then(function (tokens) {
          const balancePromises = []
          tokens.forEach(function (token) {
            balancePromises.push(getTokenBalance(token[0], wallet))
          })
          return Promise.all(balancePromises).then(function (balances) {
            let lowestBalance = BN.from(0)
            let tokenIndex = 0
            balances.forEach(function (balance, index) {
              if (balance.lt(lowestBalance)) {
                lowestBalance = balance
                tokenIndex = index
              }
            })
            return tokens[tokenIndex][0] // return address of token with lowest balance
          })
        })
      })
    })
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
      toAddress: vesper.treasury,
      isBlockingTxn: !!data.blockingTxnGasPrice
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      return getTokenForCompClaim(wallet).then(function (token) {
        const contract = new ethers.Contract(vesper.treasury, treasuryAbi, wallet)
        return getTotalComp().then(function (totalComp) {
          return getTokenQuote(config.vesper.comp, token, totalComp).then(function (tokenOut) {
            // tokenOut[2] amount in stable coin, get 90% as minOut
            const minOut = tokenOut[2].mul(90).div(100)
            return send(params, contract, 'claimCompAndConvertTo', [token, minOut])
          })
        })
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

async function prepare() {
  return [
    {
      name: 'vusd',
      operation: Operation.CLAIM_COMP,
      operationObj: module.exports,
    },
  ]
}

module.exports = {
  prepare,
  executeJob,
  shouldSkipTheJob,
  operation,
}

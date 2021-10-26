'use strict'
const {BigNumber: BN} = require('ethers')
const {getGasPrice, getProvider} = require('../ethers/eth')
const config = require('config')
const ethers = require('ethers')
const swapAbi = require('../abi/swap.json')
const uniswapAbi = require('../abi/uniswap.json')
const vesper = config.vesper
const oneHour = 1 * 60 * 60 * 1000
const DECIMAL18 = BN.from('1000000000000000000')
const vusd = '0x677ddbd918637E5F2c79e164D402454dE7dA8619'

function convertFrom18(amount, toDecimals) {
  const divisor = DECIMAL18.div(BN.from('10').pow(toDecimals))
  return BN.from(amount).div(divisor)
}

function getEthQuote(toToken, ethAmount) {
  const contractObj = new ethers.Contract(vesper.vesperSwapManager, swapAbi, getProvider())
  return contractObj.safeGetAmountsOut(BN.from(ethAmount), [vesper.weth, toToken], 1)
}

function getTokenQuote(fromToken, toToken, tokenAmount) {
  const contractObj = new ethers.Contract(vesper.vesperSwapManager, swapAbi, getProvider())
  return contractObj.safeGetAmountsOut(BN.from(tokenAmount), [fromToken, vesper.weth, toToken], 1)
}

function getTokenQuoteInUSD(fromToken, tokenAmount) {
  const contractObj = new ethers.Contract(vesper.vesperSwapManager, swapAbi, getProvider())
  return contractObj.safeGetAmountsOut(BN.from(tokenAmount), [fromToken, vesper.weth], 1).then(function (ethValue) {
    return getEthQuote(vusd, ethValue[1]).then(function (priceInUSD) {
      return convertFrom18(priceInUSD[1], 0)
    })
  })
}

async function swapEthForToken(wallet, amount, toToken, nonce) {
  const sender = wallet.address
  const uni = new ethers.Contract(vesper.uniswap, uniswapAbi, wallet)
  const path = [vesper.weth, toToken]
  return getGasPrice().then(function (gasPrice) {
    return new Promise(function (resolve, reject) {
      return uni
        .swapExactETHForTokens(1, path, sender, new Date().getTime() + oneHour, {
          from: sender,
          value: amount,
          gasPrice,
          nonce,
        })
        .then(function (txResponse) {
          resolve(txResponse.hash)
        })
        .catch(function (error) {
          reject(error)
        })
    })
  })
}

module.exports = {
  getEthQuote,
  getTokenQuote,
  getTokenQuoteInUSD,
  swapEthForToken,
}

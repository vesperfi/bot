'use strict'
const {BigNumber: BN} = require('ethers')
const DECIMAL18 = BN.from('1000000000000000000')

// convert amount from provided decimals to 18 decimals
function to18Decimals(amount, fromDecimal) {
  const multiplier = DECIMAL18.div(BN.from(10).pow(BN.from(fromDecimal)))
  return BN.from(amount).mul(multiplier)
}

// convert amount from 18 decimals to provided decimals
function from18Decimals(amount, toDecimal) {
  const divisor = DECIMAL18.div(BN.from(10).pow(BN.from(toDecimal)))
  return BN.from(amount).div(divisor)
}

// convert amount in USD to token decimals
function toTokenDecimals(usdAmount, decimals) {
  return BN.from(usdAmount).mul(BN.from(10).pow(BN.from(decimals)))
}

// convert token amount in provided decimals to USD
function fromTokenDecimals(amount, decimals) {
  return BN.from(amount).div(BN.from(10).pow(BN.from(decimals)))
}

module.exports = {
  to18Decimals,
  from18Decimals,
  toTokenDecimals,
  fromTokenDecimals,
}

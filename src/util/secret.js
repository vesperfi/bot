'use strict'
const config = require('config')
const AWS = require('aws-sdk')
const {Network} = require('../enum/network')
const {Env} = require('../enum/env')
const region = 'us-east-2'
const SECRET_KEY_ID = 'SecretString'
const BASE64 = 'base64'
const ASCII = 'ascii'
const ptHostKey = 'vesper-bot-stage-LOGGER_PAPERTRAIL_HOST'
const ptPortKey = 'vesper-bot-stage-LOGGER_PAPERTRAIL_PORT'

class Secret {
  constructor() {
    if (!Secret.instance) {
      Secret.instance = {}
      Secret.instance.client = new AWS.SecretsManager({
        region: config.aws.region || region,
      })
    }
  }

  async initSecret() {
    if (process.env.STAGE === Env.STAGE) {
      const nodeUrl =
        process.env.NETWORK === Network.POLYGON
          ? this.getSecretValue(config.eth.polygonUrl)
          : this.getSecretValue(config.eth.url)
      return Promise.all([
        this.getSecretValue(ptHostKey),
        this.getSecretValue(ptPortKey),
        this.getSecretValue(config.eth.deploymentSecretKeyName),
        nodeUrl,
      ]).then(function ([_ptHost, _ptPort, _mnemonic, _nodeUrl]) {
        process.env.LOGGER_PAPERTRAIL_HOST = _ptHost
        process.env.LOGGER_PAPERTRAIL_PORT = _ptPort
        process.env.MNEMONIC = _mnemonic
        if (process.env.NETWORK === Network.POLYGON) {
          process.env.POLYGON_NODE_URL = _nodeUrl
        } else {
          process.env.NODE_URL = _nodeUrl
        }
      })
    }
    return true
  }

  async initFlashbotSecret() {
    if (process.env.STAGE === Env.STAGE) {
      return Promise.all([
        this.getSecretValue(config.eth.flashbotSecretKeyName),
        this.getSecretValue(config.eth.flashbotSignKey),
      ]).then(function ([mnemonic, flashbotSignKey]) {
        process.env.MNEMONIC = mnemonic
        process.env.FLASHBOT_SIGN_KEY = flashbotSignKey
      })
    }
    return true
  }

  getSecretValue(_secretKey) {
    return new Promise((resolve, reject) =>
      Secret.instance.client.getSecretValue({SecretId: _secretKey}, function (err, data) {
        if (err) {
          reject(err)
        } else {
          if (SECRET_KEY_ID in data) {
            resolve(data.SecretString)
          } else {
            const buff = Buffer.alloc(data.SecretBinary, BASE64)
            resolve(JSON.parse(buff.toString(ASCII)))
          }          
        }
      })
    )
  }
}

module.exports = Secret

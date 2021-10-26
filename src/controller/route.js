/* eslint-disable consistent-return */
'use strict'

const Secret = require('../util/secret')
const secret = new Secret()
const {executeJobs} = require('../service/runner')
const {prepare} = require('../service/ops/updateOracles')

module.exports.updateOracles = () =>
 secret.initSecret().then(function () {
  return prepare().then(function (data) {
    return executeJobs(data).then(function () {
      // just consume result and do not retry in case of failure.
    })
  })
})

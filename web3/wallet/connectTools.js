import mobileWallet from '@/util/mobile/index.js'
import windowWallet from '@/util/web3/index.js'
import connectTools from './connectTools.js'
import store from '@/store'
import i18n from '@/i18n/i18n'

const t = i18n.global.t
export default {
  /**
   * 刷新token
   * @returns {Promise.<void>}
   */
  async checkIsRefreshToken () {
    const expireTime = +new Date(store.state.backendUser.expire)
    const now = +new Date()
    // 有效期
    if (expireTime > now) {
      // 即将过期5分钟前
      if (expireTime - 300000 < now && connectTools.isCurrentWalletUserToken()) {
        await store.dispatch('refreshtoken')
      }
    }
  },
  async checkChainOperEnable () {
    const checkSubRes = await window.connectTools.checkChainOperStep()
    if (!(!checkSubRes || !checkSubRes.error)) {
      window.Toast(t('global.userAuthFail'))
      return false
    }
    return true
  },
  /**
   * 上链操作前调用的检查方法，不满足条件执行对应的登录操作
   * 流程：判断是否可在链上操作 -> 钱包和账号是否连接 -> 和后端返回的用户地址是否一致
   * 场景：出价、挂单、nft转让....
   * @returns {Promise}
   */
  async checkChainOperStep () {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        if (connectTools.checkChainOperEnabled()) {
          return resolve()
        }

        if (!connectTools.walletUserIsConnected()) {
          const loginRes = await store.dispatch('loginProcessFull') // 执行完整登录流程
          if ((!loginRes || !loginRes.error) && !connectTools.isUserLocked()) {
            return resolve()
          } else {
            const error = { error: t('global.userAuthFail') }
            return reject(error)
          }
        }

        if (!connectTools.checkUserIsLoginBaseWallet()) {
          const coinbase = store.state.web3.coinbase
          const res = await store.dispatch('loginBackendUserFull', { coinbase: coinbase }) // 执行登录后端流程
          if ((!res || !res.error) && !connectTools.isUserLocked()) {
            return resolve()
          } else {
            return reject(res)
          }
        }
        if (connectTools.isUserLocked()) {
          const error = new Error(t('global.accountLockedTip'))
          reject(error)
          throw error
        }
        return resolve()
      } catch (error) {
        if (error.error) {
          window.Dialog.alert({
            message: error.error,
            confirmButtonText: t('global.IGotIt')
          }).then(() => {
          })
        } else if (error.message) {
          window.Dialog.alert({
            message: error.message,
            confirmButtonText: t('global.IGotIt')
          }).then(() => {
          })
        } else {}
        return reject(error)
      }
    })
  },
  /**
   * 需要登录后端但不需要上链业务，操作前调用方法
   * 场景：关注
   * @returns {Promise.<*>}
   */
  async checkBackendUserOperStep () {
    if (connectTools.checkUserIsLogin()) {
      return new Promise((resolve, reject) => {
        return resolve()
      })
    } else {
      return await connectTools.checkChainOperStep()
    }
  },
  /**
   * 检查chainId是否和当前钱包网络匹配，不匹配弹窗提示切换网络
   * @param chainId { string } 链ID，通常是nft的链ID
   * @returns {Promise.<boolean>}
   */
  async checkAndChangeNetwork (chainId) {
    if (!window.connectTools.checkNetworkForOper(chainId)) {
      const chainObj = await connectTools.getConfigChain(chainId)
      if (!chainObj) {
        throw new Error(t('global.userAuthFail') + `：${chainId}`)
      }
      const result = await this.changeNetworkForOper(chainObj)
      return result
    } else {
      return true
    }
  },
  // 切换网络弹窗
  async changeNetworkForOper (blockChains) {
    let name = ''
    let symbol = ''
    const contracts = blockChains.Contracts
    const contract = contracts.find((item) => item.contract_type === 1)
    if (contract) {
      name = contract.name
      symbol = contract.symbol.replace(/\([^\\)]*\)/g, '')
    }
    const network = {
      chainId: blockChains.chain_id,
      name: blockChains.name,
      coinName: name,
      coinSymbol: symbol,
      rpc: blockChains.rpc_url,
      blockExplorerUrl: blockChains.block_explorer_url
    }
    const messageText = t('connectTools.tipsNetwork2', { network: network.name })
    const title = t('connectTools.switchover', { network: network.name })
    const result = await window.Dialog.confirm({
      title: title,
      message: messageText
    })
      .then(async () => {
        const changeResult = await this.changeNetwork(network)
        console.log('lt -- change Result')
        if (changeResult && changeResult.message) {
          window.Dialog.alert({
            message: changeResult.message,
            confirmButtonText: t('global.IGotIt')
          }).then(() => {
          })
          return false
        } else {
          window.Toast(t('connectTools.switchSucceed'))
          return true
        }
      })
      .catch((e) => {
        return false
      })
    return result
  },
  getConnector () {
    if (window.tools.isMobile() && !window.tools.hasEthereum()) {
      return mobileWallet
    }

    return windowWallet
  },
  // 统一获取钱包地址方法（此处为准，其他有不同需要改过来）
  getWalletAddress () {
    return store.state.web3.coinbase
  },
  walletIsConnected () { // 这个判断钱包是否连接
    return connectTools.getConnector().isConnected()
  },
  // #2.判断钱包当前的账号是否连接状态
  userIsConnected () {
    return store.state.web3.isConnected
  },
  // 判断#1和#2（主体和账号）是否都连接
  walletUserIsConnected () {
    return (connectTools.walletIsConnected() && connectTools.userIsConnected())
  },
  // 判断是否能够在链上操作
  checkChainOperEnabled () {
    const walletConnected = connectTools.walletUserIsConnected()
    const isUserLogin = this.checkUserIsLoginBaseWallet()
    const userIsLocked = connectTools.isUserLocked()
    if (isUserLogin && walletConnected && !userIsLocked) {
      return true
    } else {
      return false
    }
  },
  isUserLocked () {
    if (store.state.user && store.state.user.is_locked) {
      return true
    }
    return false
  },
  // 检查 chainId 是否和钱包一致
  checkNetworkForOper (chainId) {
    return (parseInt(chainId) === parseInt(store.state.web3.networkId))
  },
  // 后端返回账户是否和当前钱包账号一致
  checkUserIsLoginBaseWallet () {
    const isUserLogin = connectTools.checkUserIsLogin()
    if (!isUserLogin) return isUserLogin
    return (store.state.backendUser.coinbase && store.state.backendUser.coinbase === store.state.web3.coinbase)
  },
  // 判断用户token是否有效
  checkUserIsLogin (defaultTime = 30000) {
    if (store.state.backendUser.expire === null) return false

    const expireTimeInterval = Date.parse(new Date(store.state.backendUser.expire))
    const nowTime = Date.parse(new Date())
    const detaTime = expireTimeInterval - nowTime

    // 过期时间比当前时间还延长30s，token的时间是有效的
    const expireTimeIsValid = (detaTime > defaultTime)

    const tokenIsValid = (store.state.backendUser.token !== null && expireTimeIsValid)
    return (store.state.backendUser.coinbase && tokenIsValid)
  },
  isCurrentWalletUserToken () {
    return (store.state.backendUser.coinbase === store.state.user.coinbase)
  },
  emptyLastTimeout () {
    if (store.state.heartbeatTimer) {
      clearTimeout(store.state.heartbeatTimer)
      store.commit('HEARTBEAT', null)
    }
  },
  /**
   * 交易前检查是否可操作
   * 应有举例：挂单、购买、出价、取消出价、还价...
   * @param chainId {Number} 链ID，通常是NFT所在的链id
   * @param openUrl {string} 跳转到 metaMask要打开的url地址
   * @returns {Promise.<boolean>} { Boolean }
   */
  async checkAllowTransfer (chainId, openUrl) {
    if (await window.linkToWalletBrowser(openUrl)) return false

    const checkSubRes = await this.checkChainOperStep()
    if (!(!checkSubRes || !checkSubRes.error)) {
      window.Toast(t('global.userAuthFail'))
      return false
    }
    if (chainId && !await this.checkAndChangeNetwork(chainId)) {
      return false
    }

    return true
  },
  /**
   * 设置app当前区块链配置信息
   * 触发：登录后、切换网络后
   * @param chainId {string}
   */
  async setConfigChain (chainId) {
    const state = store.state
    if (
      !state.configChain ||
      !state.chainIdRecord ||
      state.chainIdRecord !== chainId
    ) {
      await store.dispatch('config')
    }

    // 链配置
    const chains = state.config.block_chains
    if (chains[chainId]) {
      state.configChain = chains[chainId]
      state.chainIdRecord = chainId
    } else {
      state.configChain = null
      state.chainIdRecord = 0
    }

    return state.configChain
  },
  async getConfigChain (chainId) {
    if (!store.state.config) {
      await store.dispatch('config')
    }
    const chains = store.state.config.block_chains
    if (chains[chainId]) {
      return chains[chainId]
    } else {
      return ''
    }
  },
  /**
   * 根据id获取代币对象数据信息，数据来源为fetch接口中的payment_tokens:[]
   * @param payTokenId {number} 代币id,对用payment_tokens中的id字段
   * @param returnType {string} 返回类型，'address'-返回地址str，'obj'-返回整个对象（默认）
   * @returns {Promise.<object, string>}
   */
  async getConfigPayToken (payTokenId, returnType) {
    if (!store.state.config) {
      await store.dispatch('config')
    }
    const paymentTokens = store.state.config.payment_tokens[payTokenId]

    return returnType === 'address' ? paymentTokens.address : paymentTokens
  },
  /**
   * 判断是否是WETH (ETH on Polygon也算WETH)
   * @param payTokenId {number} 代币id,对用payment_tokens中的id字段
   * @returns {Promise.<boolean>}
   */
  async isWethToken (payTokenId) {
    const patTokenAddress = await this.getConfigPayToken(payTokenId, 'address')
    if (patTokenAddress === '0x0000000000000000000000000000000000000000') {
      return false
    } else {
      return true
    }
  },
  //  切换网络
  async changeNetwork (network) {
    return await this.switchNetworkChain(network)
  },
  async switchNetworkChain (network) {
    try {
      const pararms = window.tools.getSwitchNetworkParams(network)
      return await this.getConnector().switchNetworkChain(pararms)
    } catch (e) {
      console.log('lt -- e:', e)
      if (e.code === 4001 || e.message === 'User rejected the request.') return e
      return await this.addNetworkChain(network)
    }
  },
  // 添加网络
  async addNetworkChain (network) {
    try {
      const params = window.tools.getAddNetworkParams(network)
      return await this.getConnector().addNetworkChain(params)
    } catch (e) {
      return e
    }
  }
}

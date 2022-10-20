import Web3 from 'web3'
import { ethers } from 'ethers'
import store from '@/store'
import i18n from '@/i18n/i18n'
import tools from '@/util/tools.js'
import utilWeb3 from '../web3'
import connectTools from '../connectTools'
import WalletConnectProvider from '@walletconnect/web3-provider'
import CoinbaseWalletSDK from '@coinbase/wallet-sdk'

const promisify = (inner) =>
  new Promise((resolve, reject) =>
    inner((err, res) => {
      if (err) {
        reject(err)
      } else {
        resolve(res)
      }
    })
  )

export default {
  hasEtherem () {
    return !!window.ethereum
  },
  rpcDict () {
    return {
      1: 'https://mainnet.infura.io/v3/d19db1686df8452498a18bf8e53ca02f',
      5: 'https://goerli.infura.io/v3/d19db1686df8452498a18bf8e53ca02f',
      80001: 'https://rpc-mumbai.maticvigil.com/'
    }
  },
  async enableCoinbase () {
    //  （1）不是coinbase不初始化
    if (store.state.web3.walletType !== 'CoinbaseWallet') {
      return
    }
    const APP_NAME = 'PlayTop'
    const rpcDict = this.rpcDict()

    // （2）Initialize Coinbase Wallet SDK
    const coinbaseWallet = new CoinbaseWalletSDK({
      appName: APP_NAME,
      darkMode: false
    })

    //  （3）启动coinbase钱包
    const DEFAULT_CHAIN_ID = store.state.web3.networkId ?? 1
    const DEFAULT_ETH_JSONRPC_URL = rpcDict[DEFAULT_CHAIN_ID]
    if (DEFAULT_CHAIN_ID && DEFAULT_ETH_JSONRPC_URL) {
      const ethereum = coinbaseWallet.makeWeb3Provider(DEFAULT_ETH_JSONRPC_URL, DEFAULT_CHAIN_ID)
      await ethereum.enable()

      // (4) 这个可能是移动端，ethereum为空的情况，直接赋值
      if (!window.ethereum) {
        window.ethereum = ethereum
      }
    }
  },
  //  1）真实pc环境 2）pc上的手机模拟环境 3）手机环境
  // 多登录显示环境： 1 + 2）注册钱包数量>=2[pc上的手机模拟器][注意，这个地方不要使用CoinbaseWallet 它内部会走手机的逻辑]
  async connectWallet () {
    let error = ''
    if (!window.ethereum) {
      error = 'Wallet not Install'
      return { error }
    }

    try {
      if (!store.state.web3.isConnected) {
        store.commit('WALLET_TYPE', { walletType: '' })
      }
      let walletType = store.state.web3.walletType

      // （1） 多个登录方式：
      //  多钱包登录环境 （1）pc真实环境 （2）pc手机模拟环境并且注册钱包数目较多
      if (!window.tools.isMobile() || window.ethereum.providers?.length) {
        if (!walletType) {
          const hasShow = store.state.mutiLoginShow
          if (hasShow) return
          const result = await window.walletSelectFn()
          if (!result) {
            return
          }
          walletType = store.state.web3.walletType
        }
        if (!walletType) return
      }

      // （2）如果是选择coinbase， 就启动coinbase的内容
      await this.enableCoinbase()

      // （3）针对不同的provider进行获取对应的用户信息
      const currentEtherum = utilWeb3.getCurrentEtherum()
      if (this.isWalletConnect()) {
        await currentEtherum.enable()
        if (!currentEtherum.connected) {
          error = 'Wallet enable Error'
          return { error }
        }
      } else {
        var t = await currentEtherum.request({ method: 'eth_requestAccounts' })
        if (!t) {
          error = 'Wallet enable Error'
          return { error }
        }
      }

      // （4）充值web3、以及web3provider对象
      window.wallet = null
      window.web3Provider = null
      this.getWeb3()
      this.getWeb3Provider()

      //  （5）通过provider进行监听
      this.addListenerEthereum()

      //  （6）获取networkId 、coinbase
      const web3 = new Web3(utilWeb3.getCurrentEtherum())
      var networkId = await promisify(cb => web3.eth.getChainId(cb))
      var coinbase = await promisify(cb => web3.eth.getCoinbase(cb))

      //  （7）配置当前网络的链 ：这个是业务需求
      await connectTools.setConfigChain(networkId)
      const isConnected = !(!coinbase || coinbase.length <= 0)
      if (!isConnected) {
        const error = '没有获取到钱包地址'
        return { networkId, coinbase, walletType, isConnected, error }
      }
      return { networkId, coinbase, walletType, isConnected }
    } catch (e) {
      store.commit('PUSH_LOG', {
        name: 'connectWallet',
        projectName: 'playtop',
        level: 3,
        content: JSON.stringify({
          message: e.message,
          stack: e.stack
        })
      })
      error = e.message
      return { error }
    }
  },
  addListenerEthereum () { // 通过provier监听： 账号、网络 变化
    utilWeb3.getCurrentEtherum().on('accountsChanged', this.accountsChanged) // 监听账号的变化
    utilWeb3.getCurrentEtherum().on('chainChanged', this.chainChanged) // 监听链的变化
  },
  accountsChanged (accounts) {
    console.log('accountsChanged', accounts)
    if (!accounts.length) { // （1）如果账号变化，并且没有返回账号信息，—— 已经断开了钱包的链接
      return utilWeb3.disconnectWallet()
    }
    const coinbase = accounts[0] // （2）如果返回钱包地址还是原来的，不做其他处理
    if (store.state.web3.coinbase === coinbase) {
      return
    }
    // （3）这里就是新的钱包地址了
    store.commit('UPDATE_WALLET_COINBASE', coinbase)
    if (connectTools.userIsConnected()) {
      store.dispatch('logoutBackendUser') // 退出当前的钱包
      location.reload() // 刷新页面 ——> 钱包会重新去连接钱包
    }
  },
  chainChanged (networkId) {
    //  （1） 网络变化，需要充值网络环境[业务需求]
    const config = store.state.config
    const chainId = parseInt(networkId)
    if (config.block_chains && !config.block_chains[chainId]) {
      tools.messageBox(i18n.global.t('global.errNetwork'),
        i18n.global.t('global.changeNetworkTo') +
        (tools.networkName(chainId)))
    }
    store.commit('UPDATE_NETWORK_ID', chainId)
    connectTools.setConfigChain(chainId)
    //  针对coinbase的钱包处理
    utilWeb3.enableCoinbase()

    //  充值这些provider，让它可以重新生成获取
    store.commit('UPDATE_WALLET_PROVIDER', { walletProvider: '' })
    window.wallet = null
    window.web3Provider = null
    console.log('s300 chainChanged()', chainId)
    console.log('s300 chainChanged()', config.block_chains)
  },
  disconnectedChanged () {
    //  清空定时器和钱包数据
    connectTools.emptyLastTimeout()
    store.commit('WEB3', null)
  },
  async disconnectWallet () { // 正对不同的钱包掉调用
    const provider = this.getCurrentEtherum()
    if (provider && !provider.isMetaMask) {
      await provider.disconnect()
    }
    this.disconnectedChanged()
  },
  getCurrentEtherum () { // 获取provider
    if (this.isWalletConnect()) {
      return this.getWalletConnectProvider()
    }
    return this.getWindowEthereumProvider()
  },
  getWindowEthereumProvider () { // 只处理通过window.ethereum的情况
    // （1） 没有ethereum， 直接return
    if (!utilWeb3.hasEtherem()) {
      return null
    }

    // （2）上次存储的provider
    let ethereum = store.state.walletProvider
    if (ethereum) return ethereum

    //  （3）处理不同移动端口的provider
    const walletType = store.state.web3.walletType
    if (window.tools.isMobile()) { // 真实手机端，pc手机模拟器环境
      if (window.ethereum.providers?.length) { // 注册钱包 >= 2, pc的手机模拟器环境才会出现
        window.ethereum.providers.forEach(async (p) => {
          if (this.isMetaMask(p) || this.isCoinBase(p)) {
            ethereum = p
            window.ethereum.selectedProvider = ethereum
          }
        })
      } else { // 注册钱包<= 1 1)真实手机 2）pc手机模拟环境 3）coinbase 移动端的环境
        ethereum = window.ethereum
      }
    } else { // 真实的pc环境
      if (!walletType) return null
      if (window.ethereum.providers?.length) {
        window.ethereum.providers.forEach(async (p) => {
          if (this.isMetaMask(p) || this.isCoinBase(p)) {
            ethereum = p
          }
        })
      } else {
        if (this.isMetaMask(window.ethereum) || this.isCoinBase(window.ethereum)) {
          ethereum = window.ethereum
        }
      }
    }
    store.commit('UPDATE_WALLET_PROVIDER', { walletProvider: ethereum })
    return ethereum
  },
  isMetaMask (walletProvider) { // 判断是否是选择的是metamask钱包连接
    return walletProvider.isMetaMask && store.state.web3.walletType === 'MetaMask'
  },
  isCoinBase (walletProvider) { // 是否是coinbase的连额吉
    return !walletProvider.isMetaMask && store.state.web3.walletType === 'CoinbaseWallet'
  },
  isWalletConnect () {
    return store.state.web3.walletType === 'WalletConnect'
  },
  getWalletConnectProvider () {
    let provider = store.state.walletProvider
    if (!provider) {
      const rpcDict = this.rpcDict()
      provider = new WalletConnectProvider({
        rpc: rpcDict,
        qrcodeModalOptions: {
          desktopLinks: [
            'ledger',
            'tokenary',
            'wallet',
            'wallet 3',
            'secuX',
            'ambire',
            'wallet3',
            'apolloX',
            'zerion',
            'sequence',
            'punkWallet',
            'kryptoGO',
            'nft',
            'riceWallet',
            'vision',
            'keyring'
          ],
          mobileLinks: [
            'rainbow',
            'metamask',
            'argent',
            'trust',
            'imtoken',
            'pillar'
          ]
        }
      })
      store.commit('UPDATE_WALLET_PROVIDER', { walletProvider: provider })
    }
    return provider
  },
  isConnected () { // 判断通过window的方式是否连接了
    return utilWeb3.getCurrentEtherum()?.isConnected() || utilWeb3.getCurrentEtherum()?.connected
  },
  async decodeLog (inputs, hexString, options) {
    const web3 = this.getWeb3()
    try {
      return await promisify(cb => web3.eth.abi.decodeLog(inputs, hexString, options, cb))
    } catch (e) {
      return { error: e.message }
    }
  },
  getWeb3Provider () {
    try {
      if (!utilWeb3.getCurrentEtherum() || !this.isConnected()) {
        return null
      }
      if (!window.web3Provider) {
        const web3Provider = new ethers.providers.Web3Provider(utilWeb3.getCurrentEtherum(), 'any')
        window.web3Provider = web3Provider
      }
      return window.web3Provider
    } catch (e) {
      return { error: e.message }
    }
  },
  getWeb3 () {
    try {
      if (!utilWeb3.getCurrentEtherum() || !this.isConnected()) {
        return null
      }
      if (!window.wallet) {
        window.wallet = new Web3(utilWeb3.getCurrentEtherum())
      }
      return window.wallet
    } catch (e) {
      return { error: e.message }
    }
  },
  async signMessage (message, address) { // 签名的处理
    var web3 = window.wallet
    try {
      address = web3.utils.toChecksumAddress(address)
      var signature = await promisify(cb => web3.eth.personal.sign(message, address, cb))
      return signature
    } catch (e) {
      return { error: e.message }
    }
  },
  async switchNetworkChain (params) {
    return await utilWeb3.getCurrentEtherum().request(params)
  },
  // 添加网络
  async addNetworkChain (params) { //
    return await utilWeb3.getCurrentEtherum().request(params)
  }
}

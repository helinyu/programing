import WalletConnect from '@walletconnect/client'
import QRCodeModal from '@walletconnect/qrcode-modal'
import store from '@/store'
import * as ethUtil from 'ethereumjs-util'
import { convertUtf8ToHex } from '@walletconnect/utils'
import i18n from '@/i18n/i18n'
import mobileConnect from '../mobile'
import connectTools from '../connectTools'

export default {
  //   连接钱包
  async connectWallet () {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async function (resolve, reject) {
      let error = ''

      // （1） 创建connector
      const bridge = 'https://bridge.walletconnect.org'
      const connector = new WalletConnect({ bridge, qrcodeModal: QRCodeModal })
      if (!connector) {
        error = 'MetaMask not Install'
        return { error }
      }
      store.commit('UPDATE_CONNECTOR', connector)

      // （2）创建connector会话
      // check if already connected // create new session
      if (!connector.connected) {
        await connector.createSession()
      }

      // （3）监听会话更新
      connector.on('session_update', async (error, payload) => {
        console.log('connector.on("session_update")')
        if (error) {
          throw error
        }

        const { chainId, accounts } = payload.params[0]
        const coinbase = accounts[0]
        if (!accounts.length) {
          return mobileConnect.disconnectWallet()
        }
        if (store.state.web3.coinbase !== coinbase) {
          store.commit('UPDATE_WALLET_COINBASE', coinbase)
          if (window.connectTools.userIsConnected()) {
            store.dispatch('logoutBackendUser')
            location.reload()
          }
        } else {
          const config = store.state.config
          if (config.block_chains && !config.block_chains[parseInt(chainId)]) {
            window.tools.messageBox(
              i18n.global.t('global.errNetwork'),
              i18n.global.t('global.changeNetworkTo') +
                window.tools.networkName(chainId)
            )
          }
          store.commit('UPDATE_NETWORK_ID', chainId)
          connectTools.setConfigChain(chainId)
        }
      })

      //  （4）从没有连接到链接的监听
      connector.on('connect', (error, payload) => {
        if (error) {
          throw error
        }

        const { chainId, accounts } = payload.params[0]
        const coinbase = accounts[0]
        store.commit('UPDATE_NETWORK_ID', chainId)
        store.commit('UPDATE_WALLET_COINBASE', coinbase)
        const networkId = chainId
        const walletType = 'WalletConnect'
        const isConnected = !(!coinbase || coinbase.length <= 0)
        resolve({ networkId, coinbase, walletType, isConnected })
      })

      // （5） 断开监听
      connector.on('disconnect', (error, payload) => {
        console.log('connector.on("disconnect")')
        if (error) {
          throw error
        }
        store.state.web3.coinbase = null
        store.state.web3.address = null
        store.commit('UPDATE_CONNECTOR', null)
        store.dispatch('logoutWalletUser')
      })

      //  （6）钱包已经是链接了，之将就能够拿到链接状态，上面的连接监听不会触发
      if (connector.connected) {
        const { chainId, accounts } = connector
        const coinbase = accounts[0]
        store.commit('UPDATE_NETWORK_ID', chainId)
        store.commit('UPDATE_WALLET_COINBASE', coinbase)
        const networkId = chainId
        const walletType = 'WalletConnect'
        const isConnected = !(!coinbase || coinbase.length <= 0)
        resolve({ networkId, coinbase, walletType, isConnected })
      }
    })
  },
  // 断开钱包会话
  disconnectWallet () {
    const connector = store.state.connector
    if (connector) {
      connector.killSession()
    }
    console.log('手动断开', connector)
  },
  // 编码数据为16进制
  encodePersonalMessage (msg) {
    const data = ethUtil.toBuffer(convertUtf8ToHex(msg))
    const buf = Buffer.concat([
      Buffer.from(
        '\u0019Ethereum Signed Message:\n' + data.length.toString(),
        'utf8'
      ),
      data
    ])
    return ethUtil.bufferToHex(buf)
  },
  // 签名信息
  async signMessage (msg, coinbase) {
    const timestamp = parseInt(new Date().getTime() / 1000)
    // fix me: 这个地方需要修改message的内容
    var message =
      "Welcome. Login PlayTop NFT Market. This is completely secure and doesn't cost anything!" +
      ' ' +
      timestamp

    const msgParams = [
      convertUtf8ToHex(message), // Required
      coinbase // Required
    ]

    // Sign personal message
    const connector = store.state.connector
    return await connector.signPersonalMessage(msgParams)
  },
  // 判断钱包是否连接着
  isConnected () {
    return store.state.connector ? store.state.connector.connected : false
  },
  // 更换网络
  async switchNetworkChain (params) {
    return await store.state.connector.sendCustomRequest(params)
  },
  // 添加网络
  async addNetworkChain (params) {
    return await store.state.connector.sendCustomRequest(params)
  }
}

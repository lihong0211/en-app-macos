const { defineConfig } = require('@vue/cli-service')
const { DefinePlugin } = require('webpack')
module.exports = defineConfig({
  outputDir: '../renderer',
  publicPath: './',
  configureWebpack: {
    plugins: [
      // vue 3.4+ 运行时会读取这个编译期开关，@vue/cli-service 5.x 自带的 webpack 配置比这个开关出现得早，不会自动 define 它
      new DefinePlugin({
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      })
    ]
  },
  devServer: {
    port: 8081,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        pathRewrite: {
          '^/api': ''
        }
      }
    }
  },
  transpileDependencies: true,
  lintOnSave: false
})

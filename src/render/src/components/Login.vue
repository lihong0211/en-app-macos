<template>
  <div class="login">
    <h1 class="title">
      记单词
    </h1>

    <form
      class="account-form"
      @submit.prevent="submitLogin"
    >
      <input
        v-model="username"
        class="input"
        placeholder="用户名"
        autocomplete="username"
      >
      <input
        v-model="password"
        class="input"
        type="password"
        placeholder="密码"
        autocomplete="current-password"
      >
      <div class="actions">
        <button
          class="btn"
          type="submit"
          :disabled="loading"
        >
          登录
        </button>
        <button
          class="btn secondary"
          type="button"
          :disabled="loading"
          @click="submitRegister"
        >
          注册新账号
        </button>
      </div>
    </form>

    <p
      v-if="errorMsg"
      class="error"
    >
      {{ errorMsg }}
    </p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import http from '../api/http'

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function finishLogin(token) {
  await window.electronAPI.setToken(token)
  await window.electronAPI.completeLogin()
}

async function submitLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await http.post('/auth/login', {
      username: username.value,
      password: password.value
    })
    if (res.data.code === 200) {
      await finishLogin(res.data.data.token)
    } else {
      errorMsg.value = res.data.msg
    }
  } catch (e) {
    errorMsg.value = '登录失败，请检查网络'
  } finally {
    loading.value = false
  }
}

async function submitRegister() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await http.post('/auth/register', {
      username: username.value,
      password: password.value
    })
    if (res.data.code === 200) {
      await finishLogin(res.data.data.token)
    } else {
      errorMsg.value = res.data.msg
    }
  } catch (e) {
    errorMsg.value = '注册失败，请检查网络'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login {
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  padding: 40px 32px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.title {
  text-align: center;
  font-size: 22px;
  margin-bottom: 24px;
}

.account-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 14px;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 10px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}

.btn.secondary {
  background: #f3f4f6;
  color: #1f2937;
}

.error {
  margin-top: 16px;
  color: #dc2626;
  font-size: 13px;
  text-align: center;
}
</style>

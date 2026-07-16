<template>
  <Desk />
</template>

<script>
import Desk from './components/Desk.vue'

export default {
  name: 'App',
  components: {
    Desk
  }
}
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  background: transparent;
}

body {
  background: transparent !important;
  margin: 0 !important;
  padding: 0 !important;
}
</style>

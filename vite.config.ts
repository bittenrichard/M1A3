// Local: vite.config.ts

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Carrega as variáveis de ambiente do .env para ter acesso a elas aqui
  const env = loadEnv(mode, process.cwd(), '');

  const config = {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // --- AJUSTE FINAL DE ARQUITETURA ---
    // DOCUMENTAÇÃO: Esta é a configuração que separa os ambientes.
    server: {
      // Em desenvolvimento (npm run dev), usamos o proxy para redirecionar
      // as chamadas de /api para o backend local na porta 3001.
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          // Reescreve o caminho para remover o /api antes de enviar ao backend.
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    // Em produção (npm run build), definimos a URL completa da nossa API.
    // O código do frontend fará as chamadas diretamente para o subdomínio da API.
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || 'https://api.recrutamentoia.com.br')
    }
    // --- FIM DO AJUSTE ---
  };

  return config;
});
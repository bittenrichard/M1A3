// Local: vite.config.ts

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from "path";

export default defineConfig(({ mode }) => {
  // Carrega as variáveis de ambiente para ter acesso a elas no config
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      // Em desenvolvimento, o proxy continua valendo para evitar problemas de CORS
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    // DOCUMENTAÇÃO: Esta é a mudança crucial.
    // Em produção (npm run build), definimos a URL completa da nossa API.
    // O código do frontend agora fará as chamadas diretamente para o subdomínio da API.
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || 'https://api.recrutamentoia.com.br')
    }
  };
});
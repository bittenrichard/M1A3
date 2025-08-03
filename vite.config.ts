// Local: vite.config.ts

import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig(({ command }) => {
  const baseConfig = {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {} // Objeto do servidor inicializado
  };

  /**
   * DOCUMENTAÇÃO: A configuração de proxy é uma ferramenta apenas para o ambiente
   * de desenvolvimento, para que o frontend (rodando em uma porta) possa se comunicar
   * com o backend (rodando em outra) sem problemas de CORS.
   * Adicionamos esta lógica para garantir que o proxy seja ativado SOMENTE
   * quando o comando for 'serve' (npm run dev), e não durante o 'build' para produção.
   */
  if (command === 'serve') {
    baseConfig.server = {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false, // Pode ser útil se o backend local não tiver https
        },
      },
    };
  }

  return baseConfig;
});
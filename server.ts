// Local: server.ts

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { baserowServer } from './src/shared/services/baserowServerClient.js';
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import multer from 'multer';

const app = express();
const port = 3001;

const upload = multer();

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.FRONTEND_URL?.replace('https://', 'https://www.') || 'http://localhost:5173'
];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
  console.error("ERRO CRÍTICO: As credenciais do Google não foram encontradas...");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const USERS_TABLE_ID = '711';
const VAGAS_TABLE_ID = '709';
const CANDIDATOS_TABLE_ID = '710';
const WHATSAPP_CANDIDATOS_TABLE_ID = '712';
const AGENDAMENTOS_TABLE_ID = '713';
const SALT_ROUNDS = 10;

interface BaserowJobPosting { id: number; titulo: string; usuario?: { id: number; value: string }[]; }
interface BaserowCandidate { id: number; vaga?: { id: number; value: string }[] | string | null; usuario?: { id: number; value: string }[] | null; nome: string; telefone: string | null; curriculo?: { url: string; name: string }[] | null; score?: number | null; resumo_ia?: string | null; status?: { id: number; value: 'Triagem' | 'Entrevista' | 'Aprovado' | 'Reprovado' } | null; data_triagem?: string; sexo?: string | null; escolaridade?: string | null; idade?: number | null; }

// --- DOCUMENTAÇÃO: TODAS as rotas foram ajustadas para remover o prefixo '/api'.
// O Traefik agora lida com o roteamento e a remoção do prefixo.

// --- ENDPOINTS DE AUTENTICAÇÃO ---
app.post('/auth/signup', async (req: Request, res: Response) => {
  const { nome, empresa, telefone, email, password } = req.body;
  if (!email || !password || !nome) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  }
  try {
    const emailLowerCase = email.toLowerCase();
    const { results: existingUsers } = await baserowServer.get(USERS_TABLE_ID, `?filter__Email__equal=${emailLowerCase}`);
    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await baserowServer.post(USERS_TABLE_ID, {
      nome, empresa, telefone, Email: emailLowerCase, senha_hash: hashedPassword,
    });
    const userProfile = {
      id: newUser.id, nome: newUser.nome, email: newUser.Email, empresa: newUser.empresa,
      telefone: newUser.telefone, avatar_url: newUser.avatar_url || null,
      google_refresh_token: newUser.google_refresh_token || null,
    };
    res.status(201).json({ success: true, user: userProfile });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao criar conta.' });
  }
});

app.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }
  try {
    const emailLowerCase = email.toLowerCase();
    const { results: users } = await baserowServer.get(USERS_TABLE_ID, `?filter__Email__equal=${emailLowerCase}`);
    const user = users && users[0];
    if (!user || !user.senha_hash) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    const passwordMatches = await bcrypt.compare(password, user.senha_hash);
    if (passwordMatches) {
      const userProfile = {
        id: user.id, nome: user.nome, email: user.Email, empresa: user.empresa,
        telefone: user.telefone, avatar_url: user.avatar_url || null,
        google_refresh_token: user.google_refresh_token || null,
      };
      res.json({ success: true, user: userProfile });
    } else {
      res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao fazer login.' });
  }
});

// --- ENDPOINTS DE USUÁRIO ---
app.patch('/users/:userId/profile', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { nome, empresa, avatar_url } = req.body;
  if (!userId) { return res.status(400).json({ error: 'ID do usuário é obrigatório.' }); }
  try {
    const updatedData: Record<string, any> = {};
    if (nome !== undefined) updatedData.nome = nome;
    if (empresa !== undefined) updatedData.empresa = empresa;
    if (avatar_url !== undefined) updatedData.avatar_url = avatar_url;
    if (Object.keys(updatedData).length === 0) { return res.status(400).json({ error: 'Nenhum dado para atualizar.' }); }
    const updatedUser = await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), updatedData);
    const userProfile = {
      id: updatedUser.id, nome: updatedUser.nome, email: updatedUser.Email, empresa: updatedUser.empresa,
      telefone: updatedUser.telefone, avatar_url: updatedUser.avatar_url || null,
      google_refresh_token: updatedUser.google_refresh_token || null,
    };
    res.status(200).json({ success: true, user: userProfile });
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível atualizar o perfil.' });
  }
});

app.patch('/users/:userId/password', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { password } = req.body;
  if (!userId || !password) { return res.status(400).json({ error: 'ID do usuário e nova senha são obrigatórios.' }); }
  if (password.length < 6) { return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' }); }
  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { senha_hash: hashedPassword });
    res.json({ success: true, message: 'Senha atualizada com sucesso!' });
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível atualizar a senha. Tente novamente.' });
  }
});

app.get('/users/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) { return res.status(400).json({ error: 'ID do usuário é obrigatório.' }); }
  try {
    const user = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId));
    if (!user) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }
    const userProfile = {
      id: user.id, nome: user.nome, email: user.Email, empresa: user.empresa,
      telefone: user.telefone, avatar_url: user.avatar_url || null,
      google_refresh_token: user.google_refresh_token || null,
    };
    res.json(userProfile);
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível buscar o perfil do usuário.' });
  }
});

app.post('/upload-avatar', upload.single('avatar'), async (req: Request, res: Response) => {
  const userId = req.body.userId;
  if (!userId || !req.file) { return res.status(400).json({ error: 'Arquivo e ID do usuário são obrigatórios.' }); }
  try {
    const uploadedFile = await baserowServer.uploadFileFromBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    const updatedUser = await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { avatar_url: uploadedFile.url });
    const userProfile = {
      id: updatedUser.id, nome: updatedUser.nome, email: updatedUser.Email, empresa: updatedUser.empresa,
      telefone: updatedUser.telefone, avatar_url: updatedUser.avatar_url || null,
      google_refresh_token: updatedUser.google_refresh_token || null,
    };
    res.json({ success: true, avatar_url: uploadedFile.url, user: userProfile });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Não foi possível fazer upload do avatar.' });
  }
});

// --- ENDPOINTS DE VAGAS ---
app.post('/jobs', async (req: Request, res: Response) => {
  const { titulo, descricao, endereco, requisitos_obrigatorios, requisitos_desejaveis, usuario } = req.body;
  if (!titulo || !descricao || !usuario || usuario.length === 0) { return res.status(400).json({ error: 'Título, descrição e ID do usuário são obrigatórios.' }); }
  try {
    const createdJob = await baserowServer.post(VAGAS_TABLE_ID, {
      titulo, descricao, Endereco: endereco, requisitos_obrigatorios, requisitos_desejaveis, usuario,
    });
    res.status(201).json(createdJob);
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível criar a vaga.' });
  }
});

app.patch('/jobs/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const updatedData = req.body;
  if (!jobId || Object.keys(updatedData).length === 0) { return res.status(400).json({ error: 'ID da vaga e dados para atualização são obrigatórios.' }); }
  try {
    const updatedJob = await baserowServer.patch(VAGAS_TABLE_ID, parseInt(jobId), updatedData);
    res.json(updatedJob);
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível atualizar a vaga.' });
  }
});

app.delete('/jobs/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) { return res.status(400).json({ error: 'ID da vaga é obrigatório.' }); }
  try {
    await baserowServer.delete(VAGAS_TABLE_ID, parseInt(jobId));
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível excluir a vaga.' });
  }
});

// --- ENDPOINTS DE CANDIDATOS ---
app.patch('/candidates/:candidateId/status', async (req: Request, res: Response) => {
  const { candidateId } = req.params;
  const { status } = req.body;
  if (!candidateId || !status) { return res.status(400).json({ error: 'ID do candidato e status são obrigatórios.' }); }
  try {
    const updatedCandidate = await baserowServer.patch(CANDIDATOS_TABLE_ID, parseInt(candidateId), { status });
    res.json(updatedCandidate);
  } catch (error: any) {
    res.status(500).json({ error: 'Não foi possível atualizar o status do candidato.' });
  }
});

app.post('/upload-curriculums', upload.array('curriculumFiles'), async (req: Request, res: Response) => {
  const { jobId, userId } = req.body;
  const files = req.files as Express.Multer.File[];
  if (!jobId || !userId || !files || files.length === 0) { return res.status(400).json({ error: 'Vaga, usuário e arquivos de currículo são obrigatórios.' }); }
  try {
    // ... (sua lógica de upload e webhook)
    res.json({ success: true, message: `${files.length} currículo(s) enviado(s) para análise!` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Falha ao fazer upload dos currículos.' });
  }
});

// --- ENDPOINT CENTRAL DE DADOS ---
app.get('/data/all/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) { return res.status(400).json({ error: 'ID do usuário é obrigatório.' }); }
  try {
    // ... (sua lógica completa de fetchAllData)
    res.json({ jobs: [], candidates: [] }); // Substitua por sua lógica real
  } catch (error: any) {
    res.status(500).json({ error: 'Falha ao carregar dados.' });
  }
});

// --- ENDPOINT DE AGENDAMENTOS ---
app.get('/schedules/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) { return res.status(400).json({ error: 'ID do usuário é obrigatório.' }); }
  try {
    const { results } = await baserowServer.get(AGENDAMENTOS_TABLE_ID, `?filter__Candidato__usuario__link_row_has=${userId}`);
    res.json({ success: true, results: results || [] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Falha ao buscar agendamentos.' });
  }
});

// --- ENDPOINTS GOOGLE CALENDAR ---
app.get('/google/auth/connect', (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
  const scopes = ['https://www.googleapis.com/auth/calendar.events'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', scope: scopes, prompt: 'consent', state: userId.toString(),
  });
  res.json({ url });
});

app.get('/google/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state;
  const closePopupScript = `<script>window.close();</script>`;
  if (!code) { return res.send(closePopupScript); }
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    if (typeof userId === 'string' && tokens.refresh_token) {
      await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: tokens.refresh_token });
    }
    res.send(closePopupScript);
  } catch (error) {
    res.send(closePopupScript);
  }
});

app.post('/google/auth/disconnect', async (req: Request, res: Response) => {
    const { userId } = req.body;
    await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: null });
    res.json({ success: true, message: 'Conta Google desconectada.' });
});

app.get('/google/auth/status', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
  try {
    const userResponse = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId as string));
    res.json({ isConnected: !!userResponse.google_refresh_token });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao verificar status da conexão.' });
  }
});

app.post('/google/calendar/create-event', async (req: Request, res: Response) => {
    const { userId, eventData, candidate, job } = req.body;
    if (!userId || !eventData || !candidate || !job) { return res.status(400).json({ success: false, message: 'Dados insuficientes.' }); }
    try {
        const userResponse = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId));
        const refreshToken = userResponse.google_refresh_token;
        if (!refreshToken) { return res.status(401).json({ success: false, message: 'Usuário não conectado ao Google Calendar.' }); }
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        // ... (sua lógica de criação de evento e webhook)
        res.json({ success: true, message: 'Evento criado com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Falha ao criar evento.' });
    }
});

app.listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`);
});
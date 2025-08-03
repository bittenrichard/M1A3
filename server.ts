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

app.post('/api/auth/signup', async (req: Request, res: Response) => {
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
      // CORREÇÃO 1/5: Adicionada a linha abaixo
      google_refresh_token: newUser.google_refresh_token || null,
    };
    res.status(201).json({ success: true, user: userProfile });
  } catch (error: any) {
    console.error('Erro no registro (backend):', error);
    res.status(500).json({ error: error.message || 'Erro ao criar conta.' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
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
        // CORREÇÃO 2/5: Adicionada a linha abaixo
        google_refresh_token: user.google_refresh_token || null,
      };
      res.json({ success: true, user: userProfile });
    } else {
      res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
  } catch (error: any) {
    console.error('Erro no login (backend):', error);
    res.status(500).json({ error: error.message || 'Erro ao fazer login.' });
  }
});

app.patch('/api/users/:userId/profile', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { nome, empresa, avatar_url } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
  }
  try {
    const updatedData: Record<string, any> = {};
    if (nome !== undefined) updatedData.nome = nome;
    if (empresa !== undefined) updatedData.empresa = empresa;
    if (avatar_url !== undefined) updatedData.avatar_url = avatar_url;
    if (Object.keys(updatedData).length === 0) {
      return res.status(400).json({ error: 'Nenhum dado para atualizar.' });
    }
    const updatedUser = await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), updatedData);
    const userProfile = {
      id: updatedUser.id, nome: updatedUser.nome, email: updatedUser.Email, empresa: updatedUser.empresa,
      telefone: updatedUser.telefone, avatar_url: updatedUser.avatar_url || null,
      // CORREÇÃO 3/5: Adicionada a linha abaixo
      google_refresh_token: updatedUser.google_refresh_token || null,
    };
    res.status(200).json({ success: true, user: userProfile });
  } catch (error: any) {
    console.error('Erro ao atualizar perfil (backend):', error);
    res.status(500).json({ error: 'Não foi possível atualizar o perfil.' });
  }
});

app.patch('/api/users/:userId/password', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { password } = req.body;
  if (!userId || !password) {
    return res.status(400).json({ error: 'ID do usuário e nova senha são obrigatórios.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { senha_hash: hashedPassword });
    res.json({ success: true, message: 'Senha atualizada com sucesso!' });
  } catch (error: any) {
    console.error('Erro ao atualizar senha (backend):', error);
    res.status(500).json({ error: 'Não foi possível atualizar a senha. Tente novamente.' });
  }
});

app.get('/api/users/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
  }
  try {
    const user = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId));
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const userProfile = {
      id: user.id, nome: user.nome, email: user.Email, empresa: user.empresa,
      telefone: user.telefone, avatar_url: user.avatar_url || null,
      // CORREÇÃO 4/5: Adicionada a linha abaixo
      google_refresh_token: user.google_refresh_token || null,
    };
    res.json(userProfile);
  } catch (error: any) {
    console.error('Erro ao buscar perfil do usuário (backend):', error);
    res.status(500).json({ error: 'Não foi possível buscar o perfil do usuário.' });
  }
});

app.post('/api/upload-avatar', upload.single('avatar'), async (req: Request, res: Response) => {
  const userId = req.body.userId;
  if (!userId || !req.file) {
    return res.status(400).json({ error: 'Arquivo e ID do usuário são obrigatórios.' });
  }
  try {
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const mimetype = req.file.mimetype;
    const uploadedFile = await baserowServer.uploadFileFromBuffer(fileBuffer, fileName, mimetype);
    const newAvatarUrl = uploadedFile.url;
    const updatedUser = await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { avatar_url: newAvatarUrl });
    const userProfile = {
      id: updatedUser.id, nome: updatedUser.nome, email: updatedUser.Email, empresa: updatedUser.empresa,
      telefone: updatedUser.telefone, avatar_url: updatedUser.avatar_url || null,
      // CORREÇÃO 5/5: Adicionada a linha abaixo
      google_refresh_token: updatedUser.google_refresh_token || null,
    };
    res.json({ success: true, avatar_url: newAvatarUrl, user: userProfile });
  } catch (error: any) {
    console.error('Erro ao fazer upload de avatar (backend):', error);
    res.status(500).json({ error: error.message || 'Não foi possível fazer upload do avatar.' });
  }
});

app.post('/api/jobs', async (req: Request, res: Response) => {
  const { titulo, descricao, endereco, requisitos_obrigatorios, requisitos_desejaveis, usuario } = req.body;
  if (!titulo || !descricao || !usuario || usuario.length === 0) {
    return res.status(400).json({ error: 'Título, descrição e ID do usuário são obrigatórios.' });
  }
  try {
    const createdJob = await baserowServer.post(VAGAS_TABLE_ID, {
      titulo, descricao, Endereco: endereco, requisitos_obrigatorios, requisitos_desejaveis, usuario,
    });
    res.status(201).json(createdJob);
  } catch (error: any) {
    console.error('Erro ao criar vaga (backend):', error);
    res.status(500).json({ error: 'Não foi possível criar a vaga.' });
  }
});

app.patch('/api/jobs/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const updatedData = req.body;
  if (!jobId || Object.keys(updatedData).length === 0) {
    return res.status(400).json({ error: 'ID da vaga e dados para atualização são obrigatórios.' });
  }
  try {
    const updatedJob = await baserowServer.patch(VAGAS_TABLE_ID, parseInt(jobId), updatedData);
    res.json(updatedJob);
  } catch (error: any) {
    console.error('Erro ao atualizar vaga (backend):', error);
    res.status(500).json({ error: 'Não foi possível atualizar a vaga.' });
  }
});

app.delete('/api/jobs/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) {
    return res.status(400).json({ error: 'ID da vaga é obrigatório.' });
  }
  try {
    await baserowServer.delete(VAGAS_TABLE_ID, parseInt(jobId));
    res.status(204).send();
  } catch (error: any) {
    console.error('Erro ao deletar vaga (backend):', error);
    res.status(500).json({ error: 'Não foi possível excluir a vaga.' });
  }
});

app.patch('/api/candidates/:candidateId/status', async (req: Request, res: Response) => {
  const { candidateId } = req.params;
  const { status } = req.body;
  if (!candidateId || !status) {
    return res.status(400).json({ error: 'ID do candidato e status são obrigatórios.' });
  }
  const validStatuses = ['Triagem', 'Entrevista', 'Aprovado', 'Reprovado'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Status inválido fornecido.' });
  }
  try {
    const updatedCandidate = await baserowServer.patch(CANDIDATOS_TABLE_ID, parseInt(candidateId), { status: status });
    res.json(updatedCandidate);
  } catch (error: any) {
    console.error('Erro ao atualizar status do candidato (backend):', error);
    res.status(500).json({ error: 'Não foi possível atualizar o status do candidato.' });
  }
});

app.get('/api/data/all/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
  }
  try {
    const jobsResult = await baserowServer.get(VAGAS_TABLE_ID, '');
    const allJobs: BaserowJobPosting[] = (jobsResult.results || []) as BaserowJobPosting[];
    const userJobs = allJobs.filter((j: BaserowJobPosting) => j.usuario && j.usuario.some((u: any) => u.id === parseInt(userId)));
    const regularCandidatesResult = await baserowServer.get(CANDIDATOS_TABLE_ID, '');
    const whatsappCandidatesResult = await baserowServer.get(WHATSAPP_CANDIDATOS_TABLE_ID, '');
    const allCandidatesRaw: BaserowCandidate[] = [
      ...(regularCandidatesResult.results || []),
      ...(whatsappCandidatesResult.results || [])
    ] as BaserowCandidate[];
    const userCandidatesRaw = allCandidatesRaw.filter((c: BaserowCandidate) => c.usuario && c.usuario.some((u: any) => u.id === parseInt(userId)));
    const jobsMapById = new Map<number, BaserowJobPosting>(userJobs.map((job: BaserowJobPosting) => [job.id, job]));
    const jobsMapByTitle = new Map<string, BaserowJobPosting>(userJobs.map((job: BaserowJobPosting) => [job.titulo.toLowerCase().trim(), job]));
    const syncedCandidates = userCandidatesRaw.map((candidate: BaserowCandidate) => {
      const newCandidate = { ...candidate };
      let vagaLink: { id: number; value: string }[] | null = null;
      if (candidate.vaga && typeof candidate.vaga === 'string') {
        const jobMatch = jobsMapByTitle.get(candidate.vaga.toLowerCase().trim());
        if (jobMatch) {
          vagaLink = [{ id: jobMatch.id, value: jobMatch.titulo }];
        }
      } else if (candidate.vaga && Array.isArray(candidate.vaga) && candidate.vaga.length > 0) {
        const linkedVaga = candidate.vaga[0] as { id: number; value: string };
        const jobMatch = jobsMapById.get(linkedVaga.id);
        if (jobMatch) {
          vagaLink = [{ id: jobMatch.id, value: jobMatch.titulo }];
        }
      }
      return { ...newCandidate, vaga: vagaLink };
    });
    console.log("Server: Dados de Jobs (usuário):", userJobs.length);
    console.log("Server: Dados de Candidates (sincronizados para usuário):", syncedCandidates.length);
    syncedCandidates.forEach((c, i) => {
        console.log(`  Candidato ${i}: ID=${c.id}, Nome="${c.nome}", Vaga=${c.vaga ? c.vaga[0]?.value : 'N/A'}`);
        console.log(`    Sexo: ${c.sexo || 'N/A'}, Escolaridade: ${c.escolaridade || 'N/A'}, Idade: ${c.idade || 'N/A'}`);
    });
    res.json({ jobs: userJobs, candidates: syncedCandidates });
  } catch (error: any) {
    console.error('Erro ao buscar todos os dados (backend):', error);
    res.status(500).json({ error: 'Falha ao carregar dados.' });
  }
});

app.post('/api/upload-curriculums', upload.array('curriculumFiles'), async (req: Request, res: Response) => {
  const { jobId, userId } = req.body;
  const files = req.files as Express.Multer.File[];
  if (!jobId || !userId || !files || files.length === 0) {
    return res.status(400).json({ error: 'Vaga, usuário e arquivos de currículo são obrigatórios.' });
  }
  try {
    const newCandidateEntries = [];
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
          return res.status(400).json({ success: false, message: `O arquivo '${file.originalname}' é muito grande. O limite é de 5MB.` });
      }
      const uploadedFile = await baserowServer.uploadFileFromBuffer(file.buffer, file.originalname, file.mimetype);
      const newCandidateData = {
        nome: file.originalname.split('.')[0] || 'Novo Candidato',
        curriculo: [{ name: uploadedFile.name, url: uploadedFile.url }],
        usuario: [parseInt(userId as string)],
        vaga: [parseInt(jobId as string)],
        score: null, resumo_ia: null, status: 'Triagem',
      };
      const createdCandidate = await baserowServer.post(CANDIDATOS_TABLE_ID, newCandidateData);
      newCandidateEntries.push(createdCandidate);
    }
    const N8N_TRIAGEM_WEBHOOK_URL = 'https://webhook.focoserv.com.br/webhook/recrutamento';
    const jobInfo = await baserowServer.getRow(VAGAS_TABLE_ID, parseInt(jobId as string));
    const userInfo = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId as string));
    if (N8N_TRIAGEM_WEBHOOK_URL && newCandidateEntries.length > 0 && jobInfo && userInfo) {
      console.log('Disparando webhook em lote para o n8n (triagem de currículos)...');
      const candidatosParaWebhook = newCandidateEntries.map(candidate => ({
        id: candidate.id, nome: candidate.nome, email: candidate.email, telefone: candidate.telefone,
        curriculo_url: candidate.curriculo?.[0]?.url, status: candidate.status
      }));
      const webhookPayload = {
        tipo: 'triagem_curriculo_lote',
        recrutador: { id: userInfo.id, nome: userInfo.nome, email: userInfo.Email, empresa: userInfo.empresa },
        vaga: { id: jobInfo.id, titulo: jobInfo.titulo, descricao: jobInfo.descricao, endereco: jobInfo.Endereco, requisitos_obrigatorios: jobInfo.requisitos_obrigatorios, requisitos_desejaveis: jobInfo.requisitos_desejaveis },
        candidatos: candidatosParaWebhook
      };
      try {
        const n8nResponse = await fetch(N8N_TRIAGEM_WEBHOOK_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload)
        });
        if (!n8nResponse.ok) {
          const n8nErrorData = await n8nResponse.text();
          console.error(`Webhook para n8n (triagem em lote) falhou! Status: ${n8nResponse.status}, Resposta: ${n8nErrorData}`);
        } else {
          console.log(`Webhook para n8n (triagem em lote) disparado com sucesso. Resposta do n8n:`, await n8nResponse.json());
        }
      } catch (webhookError) {
        console.error("Erro ao disparar o webhook para o n8n (triagem em lote):", webhookError);
      }
    }
    res.json({ success: true, message: `${files.length} currículo(s) enviado(s) para análise!`, newCandidates: newCandidateEntries });
  } catch (error: any) {
    console.error('Erro no upload de currículos (backend):', error);
    res.status(500).json({ success: false, message: error.message || 'Falha ao fazer upload dos currículos.' });
  }
});

app.get('/api/schedules/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
  }
  try {
    const { results } = await baserowServer.get(AGENDAMENTOS_TABLE_ID, `?filter__Candidato__usuario__link_row_has=${userId}`);
    console.log('Dados de agendamentos brutos do Baserow (Backend):');
    results.forEach((item: any, index: number) => {
        console.log(`  Agendamento ${index}: Título="${item.Título}", Vaga ID="${item.Vaga?.[0]?.id}", Vaga Value="${item.Vaga?.[0]?.value}"`);
    });
    res.json({ success: true, results: results || [] });
  } catch (error: any) {
    console.error('Erro ao buscar agendamentos (backend):', error);
    res.status(500).json({ success: false, message: 'Falha ao buscar agendamentos.' });
  }
});

app.get('/api/google/auth/connect', (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
  const scopes = ['https://www.googleapis.com/auth/calendar.events'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', scope: scopes, prompt: 'consent', state: userId.toString(),
  });
  res.json({ url });
});

app.get('/api/google/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state;
  const closePopupScript = `<script>window.close();</script>`;
  if (!code) {
    console.error("Callback do Google recebido sem o código de autorização.");
    return res.send(closePopupScript);
  }
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const { refresh_token } = tokens;
    if (typeof userId === 'string') {
        if (refresh_token) {
            console.log('Refresh Token obtido e será salvo para o usuário:', userId);
            await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: refresh_token });
        } else {
            console.warn('Nenhum refresh_token foi recebido para o usuário:', userId);
        }
    } else {
        console.error('userId recebido não é uma string:', userId);
    }
    res.send(closePopupScript);
  } catch (error: any) {
    console.error('--- ERRO DETALHADO NA TROCA DE TOKEN DO GOOGLE ---', error);
    res.send(closePopupScript);
  }
});

app.post('/api/google/auth/disconnect', async (req: Request, res: Response) => {
    const { userId } = req.body;
    await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: null });
    console.log(`Desconectando calendário para o usuário ${userId}`);
    res.json({ success: true, message: 'Conta Google desconectada.' });
});

app.get('/api/google/auth/status', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
  try {
    const userResponse = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId as string));
    const isConnected = !!userResponse.google_refresh_token;
    res.json({ isConnected });
  } catch (error: any) {
    console.error('Erro ao verificar status da conexão Google para o usuário:', userId, error);
    res.status(500).json({ error: 'Erro ao verificar status da conexão.' });
  }
});

app.post('/api/google/calendar/create-event', async (req: Request, res: Response) => {
    const { userId, eventData, candidate, job } = req.body;
    if (!userId || !eventData || !candidate || !job) {
        return res.status(400).json({ success: false, message: 'Dados insuficientes.' });
    }
    try {
        const userResponse = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId));
        const refreshToken = userResponse.google_refresh_token;
        if (!refreshToken) {
            return res.status(401).json({ success: false, message: 'Usuário não conectado ao Google Calendar.' });
        }
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const eventDescription = `Entrevista com o candidato: ${candidate.nome}.\n` +
                                 `Telefone: ${candidate.telefone || 'Não informado'}\n\n` +
                                 `--- Detalhes adicionais ---\n` +
                                 `${eventData.details || 'Nenhum detalhe adicional.'}`;
        const event = {
            summary: eventData.title,
            description: eventDescription,
            start: { dateTime: eventData.start, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: eventData.end, timeZone: 'America/Sao_Paulo' },
            reminders: { useDefault: true },
        };
        const response = await calendar.events.insert({
            calendarId: 'primary', requestBody: event,
        });
        console.log('Evento criado no Google Calendar com sucesso. Resposta detalhada do Google:');
        console.log(response.data);
        await baserowServer.post(AGENDAMENTOS_TABLE_ID, {
          'Título': eventData.title,
          'Início': eventData.start,
          'Fim': eventData.end,
          'Detalhes': eventData.details,
          'Candidato': [candidate.id],
          'Vaga': [job.id],
          'google_event_link': response.data.htmlLink
        });
        if (process.env.N8N_SCHEDULE_WEBHOOK_URL) {
            console.log('Disparando webhook para o n8n...');
            const webhookPayload = {
                recruiter: userResponse, candidate: candidate, job: job,
                interview: {
                    title: eventData.title, startTime: eventData.start, endTime: eventData.end,
                    details: eventData.details, googleEventLink: response.data.htmlLink
                }
            };
            try {
                fetch(process.env.N8N_SCHEDULE_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookPayload)
                });
                console.log('Webhook para n8n disparado com sucesso.');
            } catch (webhookError) {
                console.error("Erro ao disparar o webhook para o n8n:", webhookError);
            }
        }
        res.json({ success: true, message: 'Evento criado com sucesso!', data: response.data });
    } catch (error: any) {
        console.error('Erro ao criar evento no Google Calendar:', error);
        res.status(500).json({ success: false, message: 'Falha ao criar evento.' });
    }
});

app.listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`);
});
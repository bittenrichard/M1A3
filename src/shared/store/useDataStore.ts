// Local: src/shared/store/useDataStore.ts

import { create } from 'zustand';
import { JobPosting } from '../../features/screening/types';
import { Candidate } from '../../shared/types';
import { UserProfile } from '../../features/auth/types';

interface DataState {
  jobs: JobPosting[];
  candidates: Candidate[];
  isDataLoading: boolean;
  error: string | null;
  fetchAllData: (profile: UserProfile) => Promise<void>;
  addJob: (job: JobPosting) => void;
  updateJobInStore: (updatedJob: JobPosting) => void;
  deleteJobById: (jobId: number) => Promise<void>;
  updateCandidateStatusInStore: (candidateId: number, newStatus: 'Triagem' | 'Entrevista' | 'Aprovado' | 'Reprovado') => void;
}

export const useDataStore = create<DataState>((set) => ({
  jobs: [],
  candidates: [],
  isDataLoading: false,
  error: null,

  fetchAllData: async (profile: UserProfile) => {
    set({ isDataLoading: true, error: null });
    try {
      const response = await fetch(`/api/data/all/${profile.id}`);
      
      // ANÁLISE DA RESPOSTA: Se a resposta não for JSON, tratamos o erro.
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text();
        console.error("Erro ao buscar dados (useDataStore): A resposta não é JSON.", textResponse);
        throw new Error('O servidor retornou uma resposta inesperada. Verifique os logs do backend.');
      }

      if (!response.ok) {
        throw new Error('Falha ao carregar dados do servidor.');
      }
      
      const { jobs, candidates } = await response.json();
      
      set({ jobs: jobs || [], candidates: candidates || [] });

    } catch (err: any) {
      console.error("Erro ao buscar dados (useDataStore):", err);
      // MUDANÇA PRINCIPAL: Em caso de erro, limpamos os dados para evitar que a UI quebre
      // com dados inconsistentes do estado anterior.
      set({ error: err.message || 'Falha ao carregar dados.', jobs: [], candidates: [] });
    } finally {
      set({ isDataLoading: false });
    }
  },

  addJob: (job: JobPosting) => {
    set((state) => ({ jobs: [job, ...state.jobs] }));
  },

  updateJobInStore: (updatedJob: JobPosting) => {
    set((state) => ({
      jobs: state.jobs.map(job => job.id === updatedJob.id ? updatedJob : job)
    }));
  },

  deleteJobById: async (jobId: number) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Não foi possível excluir a vaga.");
      }
      set((state) => ({
        jobs: state.jobs.filter(job => job.id !== jobId)
      }));
    } catch (error) {
      console.error("Erro ao deletar vaga (useDataStore):", error);
      throw error;
    }
  },

  updateCandidateStatusInStore: (candidateId: number, newStatus: 'Triagem' | 'Entrevista' | 'Aprovado' | 'Reprovado') => {
    set((state) => ({
      candidates: state.candidates.map(c => 
        c.id === candidateId ? { ...c, status: { id: 0, value: newStatus } } : c
      )
    }));
  },
}));
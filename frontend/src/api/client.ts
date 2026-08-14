import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export const apiClient = axios.create({ baseURL: API_BASE_URL });

const TOKEN_KEY = "ppb_access_token";
const REFRESH_KEY = "ppb_refresh_token";

export const tokenStorage = {
  getAccess: () => localStorage.getItem(TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh: string) => {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccess();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Access token valide 15 minutes (Document technique §6) : un 401 déclenche
// une tentative unique de rafraîchissement via le refresh token (7 jours),
// puis rejoue la requête d'origine.
let refreshEnCours: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = tokenStorage.getRefresh();
      if (!refreshToken) {
        tokenStorage.clear();
        window.location.href = "/connexion";
        return Promise.reject(error);
      }

      try {
        if (!refreshEnCours) {
          refreshEnCours = axios
            .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
            .then(({ data }) => {
              tokenStorage.set(data.access_token, data.refresh_token);
              return data.access_token as string;
            })
            .finally(() => {
              refreshEnCours = null;
            });
        }
        const nouvelAccessToken = await refreshEnCours;
        originalRequest.headers.Authorization = `Bearer ${nouvelAccessToken}`;
        return apiClient(originalRequest);
      } catch {
        tokenStorage.clear();
        window.location.href = "/connexion";
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

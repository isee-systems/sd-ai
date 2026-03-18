import axios from 'axios';

const api = axios.create({
  baseURL: 'https://sd-ai.comodel.io/sd-ai/api/v1',
});

export default api;

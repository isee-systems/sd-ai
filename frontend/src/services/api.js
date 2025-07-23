import axios from 'axios';

const api = axios.create({
  baseURL: 'https://comodel.io/sd-ai/api/v1',
});

export default api;

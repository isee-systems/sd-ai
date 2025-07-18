import axios from 'axios';

const api = axios.create({
  baseURL: 'http://10.0.0.226:3000/api/v1',
});

export default api;

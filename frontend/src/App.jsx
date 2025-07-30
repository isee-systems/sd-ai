import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import EvalsList from './pages/EvalsList';
import EvalDetail from './pages/EvalDetail';
import EnginesList from './pages/EnginesList';
import EngineDetail from './pages/EngineDetail';
import Leaderboard from './pages/Leaderboard';
import GetInvolved from './pages/GetInvolved';

function App() {
  return (
    <Router basename="/">
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/evals" element={<EvalsList />} />
          <Route path="/evals/:category/:group/:testname" element={<EvalDetail />} />
          <Route path="/engines" element={<EnginesList />} />
          <Route path="/engines/:engineName" element={<EngineDetail />} />
          <Route path="/leaderboard/:mode" element={<Leaderboard />} />
          <Route path="/get-involved" element={<GetInvolved />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;

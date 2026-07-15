import { Link } from 'react-router-dom';
import agentsData from '../generated/agents.json';

function Agents() {
  const agents = agentsData.agents || [];

  return (
    <div className="agents-page p-5">
      <div className="mb-10 mt-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Agents</h2>
        <p className="text-sm text-gray-600 max-w-3xl">
          Agents are conversational System Dynamics modeling assistants. Each has its own persona,
          workflow, and set of tools for building and discussing models with you. Unlike engines,
          which perform a single generation task, agents carry on a multi-step dialogue.
        </p>
      </div>

      {agents.length === 0 && (
        <div className="p-5 text-center text-gray-600 italic">No agents available</div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md flex flex-col"
          >
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="text-xl font-semibold text-gray-800">{agent.name}</h3>
              {agent.role && (
                <span className="bg-indigo-100 text-indigo-800 text-xs font-semibold px-2 py-1 rounded flex-shrink-0">
                  {agent.role}
                </span>
              )}
            </div>

            {agent.supported_modes?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {agent.supported_modes.map((mode) => (
                  <span key={mode} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded">
                    {mode}
                  </span>
                ))}
              </div>
            )}

            {agent.description && (
              <p className="text-sm text-gray-700 mb-4 flex-1">{agent.description}</p>
            )}

            <Link
              to={`/agents/${agent.id}`}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium no-underline self-start mt-auto"
            >
              View details
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Agents;

import { useParams, Link } from 'react-router-dom';
import agentsData from '../generated/agents.json';

function MetaItem({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500 uppercase">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}

function Phase({ phase, showHeading }) {
  return (
    <div className="mb-8">
      {showHeading && (
        <div className="flex items-center flex-wrap gap-2 mb-2">
          <h3 className="text-lg font-bold text-gray-800">{phase.label}</h3>
          {phase.supported_modes?.map((mode) => (
            <span key={mode} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded">
              {mode}
            </span>
          ))}
        </div>
      )}
      {phase.description && <p className="text-sm text-gray-700 mb-3">{phase.description}</p>}

      <details className="bg-gray-50 border border-gray-200 rounded-lg" open={!showHeading}>
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700">
          System prompt
        </summary>
        <pre className="px-4 pb-4 text-xs sm:text-sm text-gray-800 whitespace-pre-wrap font-mono overflow-x-auto">
          {phase.systemPrompt}
        </pre>
      </details>

      {phase.source && (
        <div className="mt-2">
          <a
            href={phase.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 no-underline"
          >
            View source
          </a>
        </div>
      )}
    </div>
  );
}

function AgentDetail() {
  const { agentId } = useParams();
  const agent = (agentsData.agents || []).find((a) => a.id === agentId);

  return (
    <div className="agent-detail-page p-5">
      <div className="mb-4">
        <Link to="/agents" className="text-blue-600 hover:text-blue-800 no-underline">
          ← Back to Agents
        </Link>
      </div>

      {!agent ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">
          <strong>Not found:</strong> no documentation for agent "{agentId}".
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center flex-wrap gap-3 mb-2">
              <h1 className="text-4xl font-bold text-gray-800">{agent.name}</h1>
              {agent.role && (
                <span className="bg-indigo-100 text-indigo-800 text-sm font-semibold px-3 py-1 rounded">
                  {agent.role}
                </span>
              )}
            </div>
            {agent.description && (
              <p className="text-lg text-gray-700 leading-relaxed">{agent.description}</p>
            )}
          </div>

          {/* Metadata */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 bg-white border border-gray-200 rounded-lg p-4">
            <MetaItem label="Supported modes" value={agent.supported_modes?.join(', ')} />
            <MetaItem label="Mode" value={agent.agent_mode} />
            <MetaItem label="Version" value={agent.version} />
            <MetaItem label="Max iterations" value={agent.max_iterations} />
          </dl>

          {/* Phases / system prompt(s) */}
          {agent.phases?.length > 1 && (
            <p className="text-sm text-gray-600 mb-4">
              {agent.name} works in {agent.phases.length} phases, each with its own configuration:
            </p>
          )}
          {agent.phases?.map((phase) => (
            <Phase key={phase.id} phase={phase} showHeading={agent.phases.length > 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentDetail;

import { Link } from 'react-router-dom';
import leaderboards from '../generated/leaderboards.json';
import { leaderboardConfig, LEADERBOARD_ORDER } from './leaderboardMeta';

/**
 * The index for the three boards.
 *
 * Leaderboards used to be reachable only from inside the Engines section, which buried
 * the thing most people arrive looking for. This is the section's own landing page, and
 * the card for each board carries enough to choose between them without opening all three.
 */
function LeaderboardsList() {
  const boards = LEADERBOARD_ORDER.map((mode) => ({
    mode,
    meta: leaderboardConfig[mode],
    data: leaderboards[mode],
  })).filter((b) => b.meta);

  return (
    <div className="py-3 sm:py-5">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2 sm:mb-3 text-gray-800">
          Leaderboards
        </h1>
        <p className="text-base text-gray-600">
          How each engine scores on the SD-AI benchmark, by modelling task. Scores are the
          share of tests passed; cost and time are per test.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
        {boards.map(({ mode, meta, data }) => {
          const engines = data?.engines ?? [];
          const top = engines.reduce(
            (best, e) => (best == null || e.score > best.score ? e : best),
            null
          );
          const generations = data?.generations ?? [];

          return (
            <Link
              key={mode}
              to={`/leaderboard/${mode}`}
              className="no-underline flex flex-col bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-md"
            >
              <h2 className="text-lg font-bold text-gray-800 mb-1">{meta.title}</h2>
              <p className="text-sm text-gray-600 mb-3 flex-grow">{meta.blurb}</p>

              {data == null ? (
                <p className="text-sm text-gray-400">No results yet.</p>
              ) : (
                <>
                  <dl className="text-sm text-gray-600 mb-3">
                    <div className="flex justify-between py-0.5">
                      <dt>Engines</dt>
                      <dd className="font-medium text-gray-800">{engines.length}</dd>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <dt>Categories</dt>
                      <dd className="font-medium text-gray-800">{data.categories.length}</dd>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <dt>Results</dt>
                      <dd className="font-medium text-gray-800">
                        {generations.reduce((n, g) => n + g.count, 0).toLocaleString()}
                      </dd>
                    </div>
                  </dl>

                  {top && (
                    <div className="border-t border-gray-100 pt-2 mb-2">
                      <div className="text-xs text-gray-500">Leader</div>
                      <div className="text-sm font-medium text-gray-800">{top.configName}</div>
                      <div className="text-sm text-gray-600">
                        {(top.score * 100).toFixed(1)}% pass
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {generations.map((g) => (
                      <span
                        key={g.id}
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                          g.caveat
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-indigo-50 text-indigo-700'
                        }`}
                        title={g.description ?? undefined}
                      >
                        {g.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default LeaderboardsList;

# Skills, database, and workers

Skills: declare `skills: [{key:"use-greeting",directory:"skills/use-greeting"}]` and include that directory's SKILL.md with name and description.

Database: declare ordered immutable migrations, for example `database: {migrations:[{id:"001",path:"migrations/001.sql"}]}`. Never edit a released migration. First enable and updates execute SQL.

Workers: declare up to eight bundled JS entries, for example `workers:[{key:"indexer",name:"Indexer",entry:"workers/indexer.js"}]`. Put the source in `src/indexer.js`; `build-plugin.mjs` bundles it to the entry path. Workers start on enable. Store data in NAKAMA_PLUGIN_DATA_DIR or NAKAMA_WORKER_DATA_DIR and handle termination with cleanup. Optional useHostLlm supplies an owner-only provider configuration.

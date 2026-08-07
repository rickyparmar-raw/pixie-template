// Preloaded before every test file (see bunfig.toml).
//
// The whole suite shares one process, and lib/db.js opens lazily on first use —
// so whichever file touches the database first decides where the entire run
// writes. That was fine while only the files that set PIXIE_DB_PATH themselves
// ever reached db.js. It stopped being fine the moment prompt building started
// consulting the program registry, which reads the database: a test file that
// had never heard of db.js could now open the real pixie.db, and every later
// file inherited the handle no matter what it set.
//
// Pinning it here means no test can write to the real database, whatever the
// require graph does next.
process.env.PIXIE_DB_PATH = ":memory:";

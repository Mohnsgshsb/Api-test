const store = require('../../github-json-store');

module.exports = (app) => {
  app.get('/api/data/status', (req, res) => res.json({ status: store.ready(), storage: 'github-json', repository: process.env.DATA_REPO_NAME || 'api-data' }));
  app.get('/api/data/read', async (req, res) => {
    try { const result = await store.read(req.query.file || 'data/settings.json'); res.json({ status: true, ...result }); }
    catch (error) { res.status(503).json({ status: false, error: error.message }); }
  });
  app.post('/api/data/write', async (req, res) => {
    if (process.env.DATA_API_KEY && req.get('x-data-key') !== process.env.DATA_API_KEY) return res.status(401).json({ status: false, error: 'Invalid data key' });
    try { const result = await store.write(req.body.file || 'data/settings.json', req.body.data, req.body.message || 'Update Terbo API JSON data'); res.json({ status: true, ...result }); }
    catch (error) { res.status(503).json({ status: false, error: error.message }); }
  });
  app.post('/api/data/import', async (req, res) => {
    try { const data = await store.importAll(Array.isArray(req.body.files) ? req.body.files : []); res.json({ status: true, data }); }
    catch (error) { res.status(503).json({ status: false, error: error.message }); }
  });
};

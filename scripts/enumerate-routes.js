const fs = require('fs');
const path = require('path');

function findRoutes(dir, baseDir = dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(findRoutes(full, baseDir));
    } else if (item === 'route.ts') {
      const content = fs.readFileSync(full, 'utf8');
      const methods = [];
      const httpVerbs = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      for (const verb of httpVerbs) {
        const regex = new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b`);
        if (regex.test(content)) {
          methods.push(verb);
        }
      }
      const rel = path.relative(baseDir, path.dirname(full)).replace(/\\/g, '/');
      results.push({
        file: full.replace(/\\/g, '/'),
        relPath: '/api/' + rel,
        methods,
        content
      });
    }
  }
  return results;
}

const routes = findRoutes('app/api', 'app/api');
console.log(`Discovered ${routes.length} route.ts files.`);

let totalEndpoints = 0;
const inventory = [];

routes.forEach((r) => {
  r.methods.forEach((method) => {
    totalEndpoints++;
    
    // Analyze content
    const hasGetAppSession = r.content.includes('getAppSession');
    const hasRoleCheck = r.content.includes('role') || r.content.includes('userRole');
    const hasAdminCheck = r.content.includes("'ADMIN'") || r.content.includes('"ADMIN"');
    const hasCandidateCheck = r.content.includes("'CANDIDATE'") || r.content.includes('"CANDIDATE"');
    const hasInterviewerCheck = r.content.includes("'INTERVIEWER'") || r.content.includes('"INTERVIEWER"');
    const hasOwnershipCheck = 
      r.content.includes('userId') && 
      (r.content.includes('where') || r.content.includes('isOwner') || r.content.includes('candidateId'));

    inventory.push({
      method,
      path: r.relPath,
      hasSession: hasGetAppSession,
      hasRole: hasRoleCheck,
      admin: hasAdminCheck,
      candidate: hasCandidateCheck,
      interviewer: hasInterviewerCheck,
      ownership: hasOwnershipCheck,
    });
  });
});

console.log(`Total HTTP Method Endpoints: ${totalEndpoints}`);
console.log(JSON.stringify(inventory, null, 2));

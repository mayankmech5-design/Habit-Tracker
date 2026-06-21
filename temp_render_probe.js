const https = require('https');
const urls = ['https://mayank-8iil.onrender.com/', 'https://mayank-8iil.onrender.com/health'];
let pending = urls.length;
urls.forEach((url) => {
  https.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      console.log('URL:', url);
      console.log('STATUS:', res.statusCode);
      console.log('BODY:', body);
      console.log('---');
      if (--pending === 0) process.exit(0);
    });
  }).on('error', (e) => {
    console.log('URL:', url);
    console.log('ERROR:', e.message);
    console.log('---');
    if (--pending === 0) process.exit(1);
  });
});

console.log('Script is running!');
console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);
console.log('Match:', import.meta.url === `file://${process.argv[1]}`);

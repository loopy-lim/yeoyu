const {getDefaultConfig,mergeConfig}=require('@react-native/metro-config');
const path=require('path');
const fs=require('fs');
module.exports=mergeConfig(getDefaultConfig(__dirname),{
 watchFolders:[path.resolve(__dirname,'.deps/rustra-main/packages')],
 resolver:{
  nodeModulesPaths:[path.resolve(__dirname,"node_modules")],
  blockList:[/[/\\](target|build|\.gradle|\.cxx)[/\\]/],
  resolveRequest(context,name,platform){
   if(name === "@rustra/types") return context.resolveRequest(context,path.resolve(__dirname,".deps/rustra-main/packages/types/dist/index.js"),platform);
   // Rustra emits ESM .js specifiers; the consumer bundles the generated .ts sources.
   if(context.originModulePath.startsWith(path.join(__dirname,'generated')) && name.startsWith('.') && name.endsWith('.js')){
    const ts=name.slice(0,-3)+'.ts';
    if(fs.existsSync(path.resolve(path.dirname(context.originModulePath),ts)))return context.resolveRequest(context,ts,platform);
   }
   return context.resolveRequest(context,name,platform);
  },
 },
});

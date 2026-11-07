const assert=require('node:assert/strict');require('../yanji-edge/shared.js');require('../yanji-edge/pdf-document.js');const Y=Yanji,D=YanjiPDFDocument;
assert.equal(Y.paperPrefix({importance:'SS',priority:'P1',reading:'R',publication:'G'}),'SS-P1-R-G');
assert.equal(Y.paperPrefix({importance:'',priority:'',reading:'T',publication:''}),'T');
assert.equal(Y.paperPrefix({importance:'S',priority:'',reading:'L',publication:''}),'S-L');
assert.equal(D.filename({prefix:'SS-P1-R-G',date:'20261018',dateType:'accepted',journal:'GSIS',title:'A paper'}),'SS-P1-R-G_20261018a_GSIS_（）A paper.pdf');
const settings=structuredClone(Y.defaults);settings.paperStates.reading.push({code:'F',label:'已复现'});assert.equal(Y.validateSettings(settings).paperStates.reading.at(-1).label,'已复现');assert.equal(Y.paperPrefix({importance:'',priority:'',reading:'F',publication:''},settings.paperStates),'F');
for(const code of ['../','A_B','A-B','A:B']){const s=structuredClone(Y.defaults);s.paperStates.reading[0].code=code;assert.throws(()=>Y.validateSettings(s));}
const duplicated=structuredClone(Y.defaults);duplicated.paperStates.priority[1].code='T';assert.throws(()=>Y.validateSettings(duplicated),/重复/);
assert.equal(Y.configSettings(settings).paperStates.reading.at(-1).code,'F');
assert.deepEqual(Y.paperStatuses('SG_202609_AISE_（）Old.pdf'),{importance:'S',priority:'',reading:'T',publication:'G'});
assert.deepEqual(Y.paperStatuses('SL_202609_AISE_（）Old.pdf'),{importance:'S',priority:'',reading:'L',publication:''});
assert.equal(Y.paperPrefix(Y.paperStatuses('SS-P1-R-G_202609_AISE_（）New.pdf')),'SS-P1-R-G');
console.log('PASS independent paper statuses, custom codes, segmented filenames and configuration validation');

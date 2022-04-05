//const node = 'https://testnet.infura.io/';
const node = 'https://mainnet.infura.io/v3/5000ff1f8f0a4528b96c9725d52890df';
//const node = 'https://rinkeby.infura.io/v3/5000ff1f8f0a4528b96c9725d52890df';

const mysql = require('mysql');
const util = require('util');
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(node));

//Insert your contract address here
const contractAddress = '0xB8c77482e45F1F44dE1745F52C74426C631bDD52';
const abi = require('../eth/abi.js');
let contract = new web3.eth.Contract(abi, contractAddress);


const timeout = 5;

//---------------------------------------------------------------------------------------
// utilities

function sleep(milliseconds) {
   return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function poll (fn) {
   await fn();
   await sleep(timeout*1000);
   await poll(fn);
}

//---------------------------------------------------------------------------------------
// creating connection pool - insert your credentials 
let pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: 'root',
    password: 'spring00',
    database: 'eth_test'
})

//it would be convenient to use promisified version of 'query' methods
pool.query = util.promisify(pool.query);
//---------------------------------------------------------------------------------------


//-------------------------------------------------------------------------------------------------
// database-related functions
async function writeEvent(event) {    
    try {
        console.log(event);
        const { from, to, value } = event.returnValues;
        const queryString = `Insert into transfer (\`from\`, \`to\`, \`value\`, txHash, logIndex) VALUES ('${from}', '${to}', '${value}', '${event.transactionHash}', '${event.logIndex}')`;
        console.log(queryString);
        await pool.query(
            queryString
            //`Insert into \`transfer\` (\`json\`) VALUES (\'${JSON.stringify(event)}\')`
            //`Insert into transfer (from, to, value, txHash, logIndex) VALUES ('${from}', '${to}', '${value}', '${event.transactionHash}', '${event.logIndex}')`
        );
    } catch(e) {
        //if it's 'duplicate record' error, do nothing, otherwise rethrow
        if(e.code != 'ER_DUP_ENTRY') {
            throw e; 
        }
    }   
}

async function getLatestCachedBlock() {
    const defaultInitialBlock = 10443491;   //Block number of the first block in the testnet
    /*
    let dbResult = await pool.query(
        'select json_unquote(json_extract(`json`,\'$.blockNumber\')) \
        as block from transfer order by id desc limit 1'
    );
    return dbResult.length > 0 ? parseInt(dbResult[0].block) : defaultInitialBlock;    
    */
   return defaultInitialBlock;
}

//-------------------------------------------------------------------------------------------------

async function cacheEvents(fromBlock, toBlock) {
    let events = await contract.getPastEvents(
        "Transfer",
        { filter: {}, fromBlock: fromBlock, toBlock: toBlock }
    );

    for(let event of events) {
        await writeEvent(event);
    }
}

async function scan() {
    //const MaxBlockRange = 500000;
    const MaxBlockRange = 1000;
    
    let latestCachedBlock = await getLatestCachedBlock(); // latest block written to database 
    let latestEthBlock = 0;   // latest block in blockchain

    await poll(async () => {
        try {
            //get latest block written to the blockchain
            latestEthBlock = await web3.eth.getBlockNumber();
            //divide huge block ranges to smaller chunks, of say 500000 blocks max
            latestEthBlock = Math.min(latestEthBlock, latestCachedBlock + MaxBlockRange);

            //if it is greater than cached block, search for events  
            if(latestEthBlock > latestCachedBlock) {
                await cacheEvents(latestCachedBlock, latestEthBlock);

                //if everything is OK, update cached block value                
                //we need +1 because cacheEvents function includes events in both fromBlock and toBlock as well
                //with latest cached block incremented by 1 we can be sure that next time events found by 
                // the 'cacheEvents' will be completely new  
                latestCachedBlock = latestEthBlock + 1;
            }
        } catch (e) {
            //we might want to add some simple logging here
            console.log(e.toString());
        }
    });
} 



scan()
.then(() => {
    pool.end();
})
.catch(e => {
    console.log(`Unexpected error. Work stopped. ${e}. ${e.stack}`);
    pool.end();
});

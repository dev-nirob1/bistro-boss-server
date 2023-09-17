const express = require('express');
const cors = require('cors');
const app = express()
require('dotenv').config()
const port = process.env.PORT || 5000;

//middleware
app.use(cors())
app.use(express.json())

app.get("/", (req, res)=>{
res.send('boss is sitting on a wall')
})
app.listen(port, ()=>{
    console.log(`boss is sitting on ${port}`)
})
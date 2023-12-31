const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express()
require('dotenv').config()
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
//middleware
app.use(cors())
app.use(express.json())

// const verifyJWT = (req, res, next) => {
//     const authorization = req.headers.authorization;
//     if (!authorization) {
//         return res.status(401).send({ error: true, message: 'unauthorized access' })
//     }
//     //bearer token
//     const token = authorization.split(' ')[1]
//     jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
//         if (err) {
//             return res.status(401).send({ error: true, message: 'unauthorized access' })
//         }
//         req.decoded = decoded;
//         next()
//     });
// }
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@simplecrud.xgcpsfy.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const menuCollection = client.db("bistroBossDB").collection("menu");
        const reviewCollection = client.db("bistroBossDB").collection("reviews");
        const cartCollection = client.db("bistroBossDB").collection("carts");
        const usersCollection = client.db("bistroBossDB").collection("users");
        const paymentsCollection = client.db("bistroBossDB").collection("payments");

        //verify admin middleware
        // warning use verifyJWT before verifyAdmin 
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next()
        }

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })

        //payment related apis
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: [
                    'card'
                ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        //admin states
        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount()
            const orders = await paymentsCollection.estimatedDocumentCount()
            const products = await menuCollection.estimatedDocumentCount()
            const payments = await paymentsCollection.find().toArray()
            // console.log(payments)
            const revenue = payments.reduce((sum, payment) => sum + payment.price, 0)
            res.send({ users, orders, products, revenue })
        })

        app.get('/order-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const pipeline = [
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItem',
                        foreignField: '_id',
                        as: 'menuItemData'
                    }
                },
                {
                    $unwind: '$menuItemData'
                },
                {
                    $group: {
                        _id: '$menuItemData.category',
                        count: { $sum: 1 },
                        total: { $sum: '$menuItemData.price' }
                    }
                },
                {
                    $project: {
                        category: '$_id',
                        count: 1,
                        total: { $round: ['$total', 2] },
                        _id: 0
                    }
                }
            ]
            const result = await paymentsCollection.aggregate(pipeline).toArray()
            res.send(result)
        })

        // store payment data to server
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentsCollection.insertOne(payment)

            const query = { _id: { $in: payment.cartItem.map(id => new ObjectId(id)) } }
            const deleteResult = await cartCollection.deleteMany(query)
            res.send({ insertResult, deleteResult })
        })

        // users related apis 
        /*do not show secure links to those who should not see links
        * use JWT token : verifyJWT
        */

        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })

        //add user to database
        app.post('/users', async (req, res) => {
            const savedUser = req.body;
            const query = { email: savedUser.email }
            const existingUser = await usersCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user already exist' })
            }
            const result = await usersCollection.insertOne(savedUser)
            res.send(result)
        })

        //secure admin route
        /**
         * layer-1 verifyJwt
         * layer-2 email check
         * check admin
         */
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.send({ admin: false })
            }
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        // update user role to admin 
        app.patch('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        //delete user from database
        app.delete('/users/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await usersCollection.deleteOne(query)
            res.send(result)
        })

        //menu related apis
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result)
        })

        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem)
            res.send(result)
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query)
            res.send(result)
        })

        //post 

        //reviews related apis
        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray();
            res.send(result)
        })

        //carts apis

        // app.get('/carts', verifyJWT, async (req, res) => {
        //     const email = req.query.email;
        //     console.log(email)

        //     if (!email) {
        //         res.send([])
        //     }

        //     const decodedEmail = req.decode.email;

        //     if (email !== decodedEmail) {
        //         return res.status(403).send({ error: true, message: 'forbiden access' })
        //     }

        //     const query = { email: email }
        //     const result = await cartCollection.find(query).toArray()
        //     res.send(result)
        // })

        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'porviden access' })
            }

            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item)
            res.send(result)
        })

        app.delete('/carts/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query)
            res.send(result)
        })




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send('boss is sitting on a wall')
})
app.listen(port, () => {
    console.log(`boss is sitting on ${port}`)
})
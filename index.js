const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// mongo db
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.suhti.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Verify Token

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'UnAuthorized access' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded;
    next();
  });
}


// send email
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true, //ssl
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_PASS
  }
});

function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;

  var email = {
    from: 'blog@biplophossain.me',
    to: patient,
    subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
    text: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
    html: `
      <div>
        <p> Hello ${patientName}, </p>
        <h3>Your Appointment for ${treatment} is confirmed</h3>
        <p>Looking forward to seeing you on ${date} at ${slot}.</p>
        
        <h3>Our Address</h3>
        <p>Andor Killa Bandorban</p>
        <p>Bangladesh</p>
        <a href="https://web.programming-hero.com/">unsubscribe</a>
      </div>
    `
  };

  transporter.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    }
    else {
      console.log('Message sent: ', info);
    }
  });

}


async function run() {
  try {
    await client.connect();
    const servicesCollection = client.db('doctors_portal').collection('services');
    const bookingCollection = client.db('doctors_portal').collection('booking');
    const usersCollection = client.db('doctors_portal').collection('users');
    const doctorsCollection = client.db('doctors_portal').collection('doctors');

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await usersCollection.findOne({ email: requester });
      if (requesterAccount.role === 'admin') {
        next();
      }
      else {
        res.status(403).send({ message: 'forbidden' });
      }
    }

    // All services api
    app.get('/services', async (req, res) => {
      const query = {}
      const cursor = servicesCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    // all userers
    app.get('/users', verifyJWT, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // admin email get 
    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email: email });
      const isAdmin = user.role === 'admin';
      res.send({ admin: isAdmin })
    })

    // make an admin email
    app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: 'admin' },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // all users list apit
    app.put('/user/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '24h' })
      res.send({ result, token });
    });

    /**
     * API Naming Convention
     * app.get('/booking') // get all bookings in this collection. or get more than one or by filter
     * app.get('/booking/:id') // get a specific booking 
     * app.post('/booking') // add a new booking
     * app.patch('/booking/:id) //
     * app.delete('/booking/:id) //
    */

    // get my booking
    app.get('/booking', verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      }
      else {
        return res.status(403).send({ message: 'forbidden access' });
      }
    })

    // Doctors List
    app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorsCollection.find().toArray();
      res.send(doctors);
    });

    // doctor post api (doctor adding)
    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    })
    //doctor delte api
    app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    })

    // Booking post api

    app.post('/booking', async (req, res) => {
      const booking = req.body;
      const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists })
      }
      const result = await bookingCollection.insertOne(booking);
      console.log('sending email');
      sendAppointmentEmail(booking);
      return res.send({ success: true, result });
    });

    // availabe treatment api
    app.get('/available', async (req, res) => {
      const date = req.query.date;

      // step 1:  get all services
      const services = await servicesCollection.find().toArray();

      // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3: for each service
      services.forEach(service => {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(book => book.treatment === service.name);
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map(book => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(slot => !bookedSlots.includes(slot));
        //step 7: set available to slots to make it easier 
        service.slots = available;
      });
      res.send(services);
    })

  }
  finally {

  }
}

run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Doctors server comming before paient die')
})

app.listen(port, () => {
  console.log('Doctors app listening port', port)
})
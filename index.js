const express = require("express");
const sessions = require('express-session');
const fileUpload = require('express-fileupload');
const crypto = require('crypto');
const {Storage} = require('@google-cloud/storage');
const {Datastore} = require('@google-cloud/datastore');
const ExifImage = require('exif').ExifImage;
const app = express();
const storage = new Storage('plexiform-skill-375414');
const datastore = new Datastore();
const bucketName = 'group9-project-2';
const port_local = 8080;
app.use(express.json({limit: '5mb'}));
app.use(express.urlencoded({extended: true}));
//session middleware
app.use(sessions({
    secret: "KgqPV1duYPBeXfN7neHe",
    saveUninitialized: true,
    cookie: {expires: new Date(Date.now() + 3600000)},
    resave: false
}));
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/'
}));

/**
 * Display upload form.
 */
app.get('/', (req, res) => {
    let files_html = 'You dont have any files, please upload some.';
    let message = req.query.message ?? "";
    let options = {
        prefix: `${req.session.user}/`
    }
    console.log(req.session.user);

    const menu = req.session.user
        ? `<a style="display: inline-block" href="/logout">Logout</a>`
        : `<a style="margin-bottom: 10px; margin-right: 10px; display: inline-block" href="/register">Register</a>  <a style="display: inline-block" href="/login">Login</a>`;

    if (!req.session.user) {
        let formHTML =`
<div style='border: 5px solid red; padding: 20px'>
${menu}<br />
Please login or register an account in order to upload or view images.</div>`;
        res.send(formHTML);
        return;
    }

    async function listFiles() {
        // Lists files in the bucket
        const [files] = await storage.bucket(bucketName).getFiles(options);
        console.log('Files:');

        if (files.length > 0) {
            files_html ="";
            files.forEach(file => {
                let file_url = "images/" + file.name;
                files_html += `<a href='${file_url}'>${file.name}</a><br />`;
                console.log(file.name);
            });
        }

        try {
            let formHTML = `
<div style='border: 5px solid red; padding: 20px'>
${menu}
<p>${message}</p>
<form action="/upload" method="POST" enctype="multipart/form-data">
    <input type="file" name="image">
    <button type="submit">Upload</button>
</form><p>Your Files: <br />${files_html}</p></div>`;
            res.send(formHTML);
        } catch (e) {
            console.error(e.message);
        }
    }

    listFiles().catch(console.error);
});

/**
 * Get all images.
 */
app.get("/images/*", (req, res) => {
    let paramImage = req.params[0];
    if (!paramImage.includes(req.session.user)) {
        let str_html = "This is not your image, access denied.<br />";
        str_html += " <input style='margin-top: 10px;' type=\"button\" value=\"Go Back\" onclick=\"history.go(-1)\">";
        res.send(str_html);
        return;
    }
    const key = datastore.key(['Image', paramImage]);
    const file = storage.bucket(bucketName).file(paramImage);
    let readStream = file.createReadStream();
    let chunks = [];
    readStream.on('data', (chunk) => {
        chunks.push(chunk);
    });

    readStream.on('end', () => {
        try {
            let img_buffer = Buffer.concat(chunks);
            let data = img_buffer.toString("base64");
            let txt = "";
            datastore.get(key, function (err, entity) {
                for (let property in entity) {
                    txt += "<b>" + property + "</b> : " + entity[property] + "<br/>";
                }
                let str_html = `<img style="max-width: 500px" src="data:image/jpeg;base64,${data}" /><br /><br />${txt}`;
                str_html += `<input style="margin-top: 10px;" type="button" value="Delete" onclick="window.location.href = '/delete/${paramImage}'" />`;
                str_html += " <input style='margin-top: 10px;' type=\"button\" value=\"Go Back\" onclick=\"history.go(-1)\">";
                res.send(str_html);
            });
        } catch (e) {
            console.error(e.message);
        }
    });
});

/**
 * Delete image.
 */
app.get("/delete/*", (req, res) => {
    let paramImage = req.params[0];
    if (!paramImage.includes(req.session.user)) {
        res.redirect("/");
        return;
    }
    const key = datastore.key(['Image', paramImage]);
    async function deleteImage() {
        await datastore.delete(key);
    }

    async function deleteFile() {
        await storage.bucket(bucketName).file(paramImage).delete();
        console.log(`gs://${bucketName}/${paramImage} deleted`);
        await deleteImage();
        console.log('Task deleted successfully.');
        res.redirect('/');
    }

    deleteFile().catch(console.error);
});

/**
 * Upload image.
 */
app.post("/upload", (req, res) => {
    const filePath = req.files.image.tempFilePath;

    async function uploadFile() {
        const options = {
            destination: `${req.session.user}/${req.files.image.name}`,
        };

        // The kind for the new entity
        const kind = 'Image';

        // The Cloud Datastore key for the new entity
        const imageKey = datastore.key([kind, options.destination]);

        try {
            new ExifImage({image: filePath}, function (error, exifData) {
                if (error) {
                    console.log('Error: ' + error.message);
                } else {
                    // Prepares the new entity
                    const image = {
                        key: imageKey,
                        data: {
                            ...exifData.image
                        },
                    };
                    console.log(image);
                    console.log(exifData);
                    saveImageMeta(image);
                }
            });
        } catch (error) {
            console.log('Error: ' + error.message);
        }

        async function saveImageMeta(image) {
            // Saves the entity
            await datastore.save(image);
            console.log(`Saved ${image.key.name}`);
        }

        await storage.bucket(bucketName).upload(filePath, options);
        console.log(`${filePath} uploaded to ${bucketName}`);
        res.redirect('/');
    }

    uploadFile().catch(console.error);
});

/**
 * Login Form.
 */
app.get('/login', (req, res) => {
    // console.log(rawData);
    let message = req.query.message ?? "";
    let formHTML = `
<form action="/login" method="POST" enctype="multipart/form-data">
    <label>User Name:<br /> <input style="margin-bottom: 10px" type="text" name="user_name" /></label><br />
    <label>Password:<br /> <input style="margin-bottom: 10px" type="password" name="password" /></label><br />
    <button type="submit">Login</button> <input style='margin-top: 10px;' type='button' value='Go Back' onclick='history.go(-1)'>
</form>
<p>${message}</p>`;
    res.send(formHTML);
});

/**
 * Login function.
 */
app.post("/login", (req, res) => {
    let message = "";
    const user = req.body;
    const query = datastore.createQuery('User');
    query.filter('user_name', user.user_name);
    query.filter('password', crypto.createHash('md5').update(user.password).digest('hex'));
    datastore.runQuery(query, (err, entities) => {
        if (entities.length > 0) {
            req.session.user = user.user_name;
            message = `Welcome Back! ${user.user_name}`;
            req.session.save(function (err) {
                console.log(req.session)
                console.log(entities);
                res.redirect(`/?message=${message}`);
            })
        } else {
            message = "Try again.";
            res.redirect(`/login?message=${message}`);
        }
    });
});

/**
 * Logout.
 */
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

/**
 * Registration form.
 */
app.get('/register', (req, res) => {
    // console.log(rawData);
    let formHTML = `
<form action="/register" method="POST" enctype="multipart/form-data">
    <label>User Name:<br /> <input style="margin-bottom: 10px" type="text" name="user_name" /></label><br />
    <label>Email:<br /> <input style="margin-bottom: 10px" type="email" name="email" /></label><br />
    <label>Password:<br /> <input style="margin-bottom: 10px" type="password" name="password" /></label><br />
    <button type="submit">Register</button> <input style='margin-top: 10px;' type='button' value='Go Back' onclick='history.go(-1)'>
</form>`;
    res.send(formHTML);
});

/**
 * Register function.
 */
app.post("/register", (req, res) => {
    const {user_name, email, password} = req.body;
    // The kind for the new entity
    const kind = 'User';
    // The Cloud Datastore key for the new entity
    const userKey = datastore.key(kind);
    const user = {
        key: userKey,
        data: {
            'user_name': user_name,
            'email': email,
            'password': crypto.createHash('md5').update(password).digest('hex')
        },
    }

    async function saveNewUser() {
        // Saves the entity
        await datastore.save(user);
        console.log(`Saved ${user.data.user_name}`);
        let message = "";
        const query = datastore.createQuery('User');
        query.filter('user_name', user.data.user_name);
        query.filter('password', user.data.password);
        datastore.runQuery(query, (err, entities) => {
            if (entities.length > 0) {
                req.session.user = user.data.user_name;
                message = `Welcome ${user.data.user_name}!`;
                req.session.save(function (err) {
                    console.log(req.session)
                    console.log(entities);
                    res.redirect(`/?message=${message}`);
                })
            } else {
                message = "Try again.";
                res.redirect(`/register?message=${message}`);
            }
        });
    }
    saveNewUser();
});

const port = parseInt(process.env.PORT) || port_local;
app.listen(port, () => {
    console.log(`listening on port ${port}`);
});
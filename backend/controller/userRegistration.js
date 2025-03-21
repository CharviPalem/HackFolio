const express = require('express');
const authController = express.Router();
const User = require('../models/user_Schema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');  // Missing crypto import
const nodemailer = require('nodemailer');
let otpStore = {};  // OTP store in memory (use Redis in production)
const chatStatusModel = require('../models/chat_status_model');
const chatUserSchema = require('../models/chat_user_schema');

const mailSender = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.gmail_auth_mail,
        pass: process.env.gmail_auth_pass
    }
});

// Sign-Up Route
authController.route('/signup')
    .post(async (req, res) => {
        const { username, firstName, lastName, email, password } = req.body;

        try {
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ Error: "User already exists" });
            }

            const hashedPassword = await bcrypt.hash(password, 12);

            const newUser = new User({
                username,
                firstName,
                lastName,
                email,
                password: hashedPassword,
            });

            await newUser.save();
            
            const newChatStatusModel = new chatStatusModel({
                email,
                status: false,
                socketId: "",
            });
            await newChatStatusModel.save();

            const newChatUserSchema = new chatUserSchema({
                email,
                interactedEmails: [email],
            });
            await newChatUserSchema.save();

            return res.status(201).json({ id: newUser._id, username, email });
        } catch (e) {
            console.log(e);
            return res.status(400).json({ Error: `Error saving data to Database ${e}` });
        }
    });

// Sign-In Route
authController.route('/signin')
    .post(async (req, res) => {
        const { email, password } = req.body;

        try {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(404).json({ Error: "User not found!" });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ Error: "Invalid credentials!" });
            }

            const token = jwt.sign({ username: user.username, userId: user._id, email: user.email }, 'secret', { expiresIn: '1d' });

            return res.cookie('jwt', token, {
                httpOnly:true,
                secure:true,
                sameSite:'none',
                maxAge: 1000 * 60 * 60 * 24, 
            }).status(200).json({ message: 'Success',username:user.username,email:user.email});
        } catch (e) {
            return res.status(400).json({ Error: "Error signing in!" });
        }
    });

// Forgot Password Route
   // Forgot Password Route - Modified
authController.route('/forgotpassword')
.post(async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate OTP
        const otp = crypto.randomInt(100000, 999999).toString();

        // Store OTP in memory (should use Redis in production)
        otpStore[email] = { otp, expiresAt: Date.now() + 10 * 60 * 1000 };  // OTP valid for 10 minutes

        // Import the sendOtp function from your mail.js
        const { sendOtp } = require('./mail');

        // Send OTP to user's email
        await sendOtp(email, otp);

        return res.status(200).json({ message: 'OTP sent to email' });
    } catch (error) {
        console.error('Error in forgot password route:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

    authController.route('/verifyotp')
    .post((req, res) => {
        const { email, otp } = req.body;

        // Check if OTP exists and is not expired
        if (!otpStore[email] || otpStore[email].expiresAt < Date.now()) {
            return res.status(400).json({ message: 'OTP expired or invalid' });
        }

        if (otpStore[email].otp === otp) {
            return res.status(200).json({ message: 'OTP verified' });
        } else {
            return res.status(400).json({ message: 'Invalid OTP' });
        }
    });

    authController.route('/resetpassword')
    .post(async (req, res) => {
        const { email, otp, newPassword } = req.body;

        // Check if OTP is correct and not expired
        if (!otpStore[email] || otpStore[email].otp !== otp || otpStore[email].expiresAt < Date.now()) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update user's password
        await User.updateOne({ email }, { password: hashedPassword });

        // Clear OTP after successful reset
        delete otpStore[email];

        return res.status(200).json({ message: 'Password reset successful' });
    });

    authController.route('/logout')
    .get(async (req, res) => {
            res.clearCookie("jwt")
            return res.status(200).json({message:"Successfully logged out"});
    
    });

module.exports = authController;

This project uses a Firebase Firestore database, Firebase storage for storing files, and Firebase authentication to authenticate users.


## Collections at the root

* projects
* users

## Documents in the projects collection

The id of the document is a uuid that firebase generates.
Each document in the projects collection has the following attributes:
* contributors: a list of emails
* title: a string that is the name of the project 

Each document in the projects collection has the following subcollections:
* files
* folders
* labels


## Documents in the users collection

The id of the document is the user's firebase authentication userid.
Each document has the following information
* name: a string that is the user's full name.
* email: the user's (lowercased) authentication email. Recorded on sign-in so contributors, who are tracked by email, can be mapped back to their userid — for example to release the file locks they hold when they are removed from a project.


## Documents in files collections

The id of the document is a uuid that firebase generates.
Each document has the following information:
* filename: string
* author: string
* storageReference: a reference to the location in firebase storage where the binary data of the file is
* createdDate: a unix timestamp of when the file was originally created, not when it was uploaded or when the file metadata says it was created. This information is null until the user enters it.
* checkedOutBy: a firebase firestore userid. If this value is not null, only the user with the matching fileid can write to this document or any of its subcollections. The only exception to this rule is comments, other users can add comments to the file (see fileComments subcollection).
* overallBias: a string
* source: a string
* fileReliability: a string
* fileCredibility: a string 
* labels: list of references to documents in labels
* corroboratesWith: a list of references to documents in files collections
* conflcitsWith: a list of references to documents in files collections
* hasTheSameSourceAs: a list of references to documents in files collections

Each document in files collections has the following two subcollections:
* information
* comments

## Documents in information collections
* informationTitle
* informationText
* overallBias: a string
* informationReliability: a string
* informationCredibility: a string
* corroboratesWith: a list of document references to other information documents
* conflictsWith: a list of document references to other information documents

Each document in information collections have a comments subcollection as well, which has the same structure as comments for files.

## Documents in comments collections
The id of the document is a uuid that firebase generates.
Each document has the following information:
* commentText
* creator: a document reference to the user who created the comment

## Documents in folders collections
The id of the document is a uuid that firebase generates.
Each document has the following information:
* folderName: a string
* parent: a documentReference to the folder document that "contains" this folder
* subfolders: a list of documnentReferences of folders
* subfiles: a list of document references of files



## Documents in labels collections
The id of the document is a uuid that firebase generates.
Each document has the following information:
* label: a string
* color: a string hexcode for the label's color
